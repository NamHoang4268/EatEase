import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSignedApiProxyHeaders } from './api-proxy-signature';

describe('createSignedApiProxyHeaders', () => {
  it('overwrites untrusted internal headers with a signature for the Vercel client IP', () => {
    const secret = 'web-proxy-test-secret-at-least-32-characters';
    const timestamp = 1_799_999_999_000;
    const callerHeaders = new Headers({
      'x-vercel-forwarded-for': '203.0.113.30',
      'x-forwarded-for': '192.0.2.100',
      'x-real-ip': '192.0.2.101',
      forwarded: 'for=192.0.2.102',
      'x-eatease-client-ip': '192.0.2.99',
      'x-eatease-proxy-timestamp': '0',
      'x-eatease-proxy-signature': 'attacker-value',
    });
    callerHeaders.append('x-eatease-client-ip', '192.0.2.98');
    callerHeaders.append('x-eatease-proxy-timestamp', '1');
    callerHeaders.append('x-eatease-proxy-signature', 'second-attacker-value');
    const headers = createSignedApiProxyHeaders({
      headers: callerHeaders,
      method: 'POST',
      pathname: '/api/v1/table-sessions/join',
      sharedSecret: secret,
      timestamp,
    });
    const expected = createHmac('sha256', secret)
      .update(['v1', timestamp, 'POST', '/api/v1/table-sessions/join', '203.0.113.30'].join('\n'))
      .digest('hex');

    expect(headers.get('x-eatease-client-ip')).toBe('203.0.113.30');
    expect(headers.get('x-eatease-proxy-timestamp')).toBe(String(timestamp));
    expect(headers.get('x-eatease-proxy-signature')).toBe(expected);
  });

  it('fails closed when Vercel does not provide one valid client IP', () => {
    expect(() =>
      createSignedApiProxyHeaders({
        headers: new Headers({ 'x-forwarded-for': '203.0.113.30' }),
        method: 'POST',
        pathname: '/api/v1/table-sessions/join',
        sharedSecret: 'web-proxy-test-secret-at-least-32-characters',
      }),
    ).toThrow('Trusted Vercel client IP is unavailable');
  });

  // Equivalent IPv6 spellings are not canonicalized yet; preserve each input representation.
  it.each([
    '203.0.113.30',
    '2001:db8::30',
    '2001:0db8:0000:0000:0000:0000:0000:0030',
    '::ffff:203.0.113.30',
  ])('signs the validated IP representation %s', (clientIp) => {
    const secret = 'web-proxy-test-secret-at-least-32-characters';
    const timestamp = 1_799_999_999_000;
    const headers = createSignedApiProxyHeaders({
      headers: new Headers({ 'x-vercel-forwarded-for': clientIp }),
      method: 'POST',
      pathname: '/api/v1/table-sessions/join',
      sharedSecret: secret,
      timestamp,
    });
    const expected = createHmac('sha256', secret)
      .update(['v1', timestamp, 'POST', '/api/v1/table-sessions/join', clientIp].join('\n'))
      .digest('hex');

    expect(headers.get('x-eatease-client-ip')).toBe(clientIp);
    expect(headers.get('x-eatease-proxy-signature')).toBe(expected);
  });

  it.each([
    '',
    'not-an-ip',
    '256.0.0.1',
    '2001:db8::g',
    '[2001:db8::30]',
    '203.0.113.30:443',
    '203.0.113.30, 198.51.100.20',
  ])('rejects invalid or comma-separated Vercel client IP %j', (clientIp) => {
    expect(() =>
      createSignedApiProxyHeaders({
        headers: new Headers({ 'x-vercel-forwarded-for': clientIp }),
        method: 'POST',
        pathname: '/api/v1/table-sessions/join',
        sharedSecret: 'web-proxy-test-secret-at-least-32-characters',
      }),
    ).toThrow('Trusted Vercel client IP is unavailable');
  });

  it('rejects duplicate Vercel client IP headers instead of selecting one address', () => {
    const headers = new Headers();
    headers.append('x-vercel-forwarded-for', '203.0.113.30');
    headers.append('x-vercel-forwarded-for', '198.51.100.20');

    expect(() =>
      createSignedApiProxyHeaders({
        headers,
        method: 'POST',
        pathname: '/api/v1/table-sessions/join',
        sharedSecret: 'web-proxy-test-secret-at-least-32-characters',
      }),
    ).toThrow('Trusted Vercel client IP is unavailable');
  });
});
