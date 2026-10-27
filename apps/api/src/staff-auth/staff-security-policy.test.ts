import { describe, expect, it } from 'vitest';
import { isTrustedOrigin } from './origin-policy.service.js';
import { readCookie, staffCookieOptions } from './staff-cookie.service.js';

describe('staff browser security policy', () => {
  it('uses local-compatible and production cross-site cookie attributes', () => {
    expect(staffCookieOptions('development')).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(staffCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
    expect(staffCookieOptions('production')).not.toHaveProperty('domain');
  });

  it('accepts only exact allowlisted origins', () => {
    const trusted = ['http://localhost:3000', 'https://eat-ease.vercel.app'];
    expect(isTrustedOrigin('https://eat-ease.vercel.app', trusted)).toBe(true);
    expect(isTrustedOrigin('https://evil.example', trusted)).toBe(false);
    expect(isTrustedOrigin(undefined, trusted)).toBe(false);
  });

  it('reads the named cookie without accepting malformed encodings', () => {
    const request = { headers: { cookie: 'other=x; eatease_staff_session=abc%20123' } };
    expect(readCookie(request as never, 'eatease_staff_session')).toBe('abc 123');
    expect(
      readCookie(
        { headers: { cookie: 'eatease_staff_session=%ZZ' } } as never,
        'eatease_staff_session',
      ),
    ).toBeUndefined();
  });
});
