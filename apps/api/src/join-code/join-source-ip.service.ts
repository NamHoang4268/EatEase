import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

export const TRUSTED_CLIENT_IP_HEADER = 'x-eatease-client-ip';
export const TRUSTED_PROXY_TIMESTAMP_HEADER = 'x-eatease-proxy-timestamp';
export const TRUSTED_PROXY_SIGNATURE_HEADER = 'x-eatease-proxy-signature';
export const TRUSTED_PROXY_SIGNATURE_MAX_AGE_MS = 60_000;

type JoinSourceIpOptions = {
  signatureRequired: boolean;
  sharedSecret: string | undefined;
};

type ProxySignatureInput = {
  clientIp: string;
  method: string;
  pathname: string;
  timestamp: string;
};

function signaturePayload(input: ProxySignatureInput): string {
  return ['v1', input.timestamp, input.method.toUpperCase(), input.pathname, input.clientIp].join(
    '\n',
  );
}

export function createProxySignature(sharedSecret: string, input: ProxySignatureInput): string {
  return createHmac('sha256', sharedSecret).update(signaturePayload(input)).digest('hex');
}

function proxyVerificationFailed(): ForbiddenException {
  return new ForbiddenException({
    code: 'TRUSTED_PROXY_REQUIRED',
    message: 'The request did not pass the trusted proxy boundary.',
    details: {},
  });
}

function requestPathname(request: Request): string {
  try {
    return new URL(request.originalUrl, 'http://internal').pathname;
  } catch {
    throw proxyVerificationFailed();
  }
}

export class JoinSourceIpService {
  constructor(private readonly options: JoinSourceIpOptions) {}

  resolve(request: Request, now = Date.now()): string {
    const clientIp = request.header(TRUSTED_CLIENT_IP_HEADER)?.trim();
    const timestamp = request.header(TRUSTED_PROXY_TIMESTAMP_HEADER)?.trim();
    const signature = request.header(TRUSTED_PROXY_SIGNATURE_HEADER)?.trim().toLowerCase();
    const hasAnyProxyHeader = Boolean(clientIp || timestamp || signature);

    if (!hasAnyProxyHeader) {
      if (this.options.signatureRequired) throw proxyVerificationFailed();
      return request.socket.remoteAddress ?? 'unknown';
    }

    const timestampNumber = timestamp && /^\d+$/.test(timestamp) ? Number(timestamp) : Number.NaN;
    if (
      !clientIp ||
      isIP(clientIp) === 0 ||
      !timestamp ||
      !Number.isSafeInteger(timestampNumber) ||
      Math.abs(now - timestampNumber) > TRUSTED_PROXY_SIGNATURE_MAX_AGE_MS ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !this.options.sharedSecret
    ) {
      throw proxyVerificationFailed();
    }

    const expected = createProxySignature(this.options.sharedSecret, {
      clientIp,
      method: request.method,
      pathname: requestPathname(request),
      timestamp,
    });
    const actualBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (!timingSafeEqual(actualBuffer, expectedBuffer)) throw proxyVerificationFailed();
    return clientIp;
  }
}
