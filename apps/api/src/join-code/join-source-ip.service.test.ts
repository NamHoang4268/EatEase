import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  createProxySignature,
  JoinSourceIpService,
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_PROXY_SIGNATURE_HEADER,
  TRUSTED_PROXY_TIMESTAMP_HEADER,
} from './join-source-ip.service.js';

const secret = 'source-ip-test-shared-secret-at-least-32-characters';
const now = 1_799_999_999_000;

function signedRequest(clientIp: string, overrides: Record<string, string> = {}): Request {
  const timestamp = String(now);
  const headers: Record<string, string> = {
    [TRUSTED_CLIENT_IP_HEADER]: clientIp,
    [TRUSTED_PROXY_TIMESTAMP_HEADER]: timestamp,
    [TRUSTED_PROXY_SIGNATURE_HEADER]: createProxySignature(secret, {
      clientIp,
      method: 'POST',
      pathname: '/api/v1/table-sessions/join',
      timestamp,
    }),
    'x-forwarded-for': '192.0.2.250',
    ...overrides,
  };
  return {
    method: 'POST',
    originalUrl: '/api/v1/table-sessions/join',
    socket: { remoteAddress: '10.0.0.5' },
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe('JoinSourceIpService', () => {
  const service = new JoinSourceIpService({ signatureRequired: true, sharedSecret: secret });

  it('uses only a fresh signed client IP and ignores X-Forwarded-For', () => {
    expect(service.resolve(signedRequest('203.0.113.20'), now)).toBe('203.0.113.20');
    expect(service.resolve(signedRequest('203.0.113.21'), now)).toBe('203.0.113.21');
  });

  it('rejects missing, invalid and expired proxy proof', () => {
    const unsigned = {
      socket: { remoteAddress: '10.0.0.5' },
      header: () => undefined,
    } as unknown as Request;
    expect(() => service.resolve(unsigned, now)).toThrow('trusted proxy boundary');
    expect(() =>
      service.resolve(
        signedRequest('203.0.113.20', { [TRUSTED_PROXY_SIGNATURE_HEADER]: '0'.repeat(64) }),
        now,
      ),
    ).toThrow('trusted proxy boundary');
    expect(() => service.resolve(signedRequest('203.0.113.20'), now + 60_001)).toThrow(
      'trusted proxy boundary',
    );
  });

  it('uses the socket peer locally and never trusts bare forwarded headers', () => {
    const local = new JoinSourceIpService({ signatureRequired: false, sharedSecret: undefined });
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      header: (name: string) => (name === 'x-forwarded-for' ? '203.0.113.99' : undefined),
    } as unknown as Request;
    expect(local.resolve(request, now)).toBe('127.0.0.1');
  });
});
