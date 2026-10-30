import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSignedApiProxyHeaders } from './api-proxy-signature';

describe('createSignedApiProxyHeaders', () => {
  it('overwrites untrusted internal headers with a signature for the Vercel client IP', () => {
    const secret = 'web-proxy-test-secret-at-least-32-characters';
    const timestamp = 1_799_999_999_000;
    const headers = createSignedApiProxyHeaders({
      headers: new Headers({
        'x-vercel-forwarded-for': '203.0.113.30',
        'x-eatease-client-ip': '192.0.2.99',
        'x-eatease-proxy-signature': 'attacker-value',
      }),
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
});
