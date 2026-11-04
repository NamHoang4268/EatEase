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

function signedRequest(
  clientIp: string,
  overrides: Record<string, string | undefined> = {},
): Request {
  const timestamp = String(now);
  const headers: Record<string, string | undefined> = {
    [TRUSTED_CLIENT_IP_HEADER]: clientIp,
    [TRUSTED_PROXY_TIMESTAMP_HEADER]: timestamp,
    [TRUSTED_PROXY_SIGNATURE_HEADER]: createProxySignature(secret, {
      clientIp,
      method: 'POST',
      pathname: '/api/v1/table-sessions/join',
      timestamp,
    }),
    'x-forwarded-for': '192.0.2.250',
    'x-real-ip': '192.0.2.251',
    forwarded: 'for=192.0.2.252',
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

  // Canonicalization remains a potential gap: equivalent IPv6 spellings retain their form.
  // These cases do not require equivalent spellings to share a signature or rate-limit bucket.
  it.each([
    '203.0.113.20',
    '2001:db8::20',
    '2001:0db8:0000:0000:0000:0000:0000:0020',
    '::ffff:203.0.113.20',
  ])('accepts a signed IP representation unchanged: %s', (clientIp) => {
    expect(service.resolve(signedRequest(clientIp), now)).toBe(clientIp);
  });

  it.each([
    'not-an-ip',
    '256.0.0.1',
    '2001:db8::g',
    '[2001:db8::20]',
    '203.0.113.20:443',
    '203.0.113.20, 198.51.100.20',
    '203.0.113.20, 203.0.113.20',
  ])('rejects invalid or combined client IP even with a matching signature: %j', (clientIp) => {
    expect(() => service.resolve(signedRequest(clientIp), now)).toThrow('trusted proxy boundary');
  });

  it.each([
    TRUSTED_CLIENT_IP_HEADER,
    TRUSTED_PROXY_TIMESTAMP_HEADER,
    TRUSTED_PROXY_SIGNATURE_HEADER,
  ])('rejects proof missing %s', (header) => {
    expect(() =>
      service.resolve(signedRequest('203.0.113.20', { [header]: undefined }), now),
    ).toThrow('trusted proxy boundary');
  });

  it.each([
    [TRUSTED_CLIENT_IP_HEADER, ''],
    [TRUSTED_PROXY_TIMESTAMP_HEADER, ''],
    [TRUSTED_PROXY_TIMESTAMP_HEADER, 'not-a-timestamp'],
    [TRUSTED_PROXY_TIMESTAMP_HEADER, String(now + 0.5)],
    [TRUSTED_PROXY_TIMESTAMP_HEADER, '9007199254740992'],
    [TRUSTED_PROXY_TIMESTAMP_HEADER, `${now}, ${now}`],
    [TRUSTED_PROXY_SIGNATURE_HEADER, ''],
    [TRUSTED_PROXY_SIGNATURE_HEADER, 'g'.repeat(64)],
    [TRUSTED_PROXY_SIGNATURE_HEADER, 'a'.repeat(63)],
    [TRUSTED_PROXY_SIGNATURE_HEADER, `${'a'.repeat(64)}, ${'b'.repeat(64)}`],
  ])('rejects malformed proof header %s = %j', (header, value) => {
    expect(() => service.resolve(signedRequest('203.0.113.20', { [header]: value }), now)).toThrow(
      'trusted proxy boundary',
    );
  });

  it.each([
    {
      field: 'client IP',
      request: signedRequest('203.0.113.20', { [TRUSTED_CLIENT_IP_HEADER]: '203.0.113.21' }),
    },
    {
      field: 'HTTP method',
      request: { ...signedRequest('203.0.113.20'), method: 'GET' } as Request,
    },
    {
      field: 'pathname',
      request: {
        ...signedRequest('203.0.113.20'),
        originalUrl: '/api/v1/table-sessions/current/join-code',
      } as Request,
    },
    {
      field: 'timestamp within the freshness window',
      request: signedRequest('203.0.113.20', {
        [TRUSTED_PROXY_TIMESTAMP_HEADER]: String(now + 1),
      }),
    },
  ])('rejects independent tampering of $field', ({ request }) => {
    expect(() => service.resolve(request, now)).toThrow('trusted proxy boundary');
  });
});
