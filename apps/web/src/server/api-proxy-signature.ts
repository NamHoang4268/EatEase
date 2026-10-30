import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const CLIENT_IP_HEADER = 'x-eatease-client-ip';
const PROXY_TIMESTAMP_HEADER = 'x-eatease-proxy-timestamp';
const PROXY_SIGNATURE_HEADER = 'x-eatease-proxy-signature';

function signaturePayload(input: {
  clientIp: string;
  method: string;
  pathname: string;
  timestamp: string;
}): string {
  return ['v1', input.timestamp, input.method.toUpperCase(), input.pathname, input.clientIp].join(
    '\n',
  );
}

export function createSignedApiProxyHeaders(input: {
  headers: Headers;
  method: string;
  pathname: string;
  sharedSecret: string;
  timestamp?: number;
}): Headers {
  const clientIp = input.headers.get('x-vercel-forwarded-for')?.trim();
  if (!clientIp || isIP(clientIp) === 0) {
    throw new Error('Trusted Vercel client IP is unavailable.');
  }

  const timestamp = String(input.timestamp ?? Date.now());
  const headers = new Headers(input.headers);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_TIMESTAMP_HEADER);
  headers.delete(PROXY_SIGNATURE_HEADER);
  headers.set(CLIENT_IP_HEADER, clientIp);
  headers.set(PROXY_TIMESTAMP_HEADER, timestamp);
  headers.set(
    PROXY_SIGNATURE_HEADER,
    createHmac('sha256', input.sharedSecret)
      .update(
        signaturePayload({
          clientIp,
          method: input.method,
          pathname: input.pathname,
          timestamp,
        }),
      )
      .digest('hex'),
  );
  return headers;
}
