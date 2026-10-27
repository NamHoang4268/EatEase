import { describe, expect, it } from 'vitest';
import { guestCookieOptions } from './guest-cookie.service.js';

describe('guestCookieOptions', () => {
  it('uses development and production cookie attributes properly', () => {
    const devOptions = guestCookieOptions('development', 1_800_000);
    expect(devOptions).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 1_800_000,
    });
    expect(devOptions).not.toHaveProperty('domain');

    const prodOptions = guestCookieOptions('production', 28_800_000);
    expect(prodOptions).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 28_800_000,
    });
    expect(prodOptions).not.toHaveProperty('domain');
  });
});
