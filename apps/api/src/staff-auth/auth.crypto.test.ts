import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashPassword, hashToken, verifyPassword } from './auth.crypto.js';

describe('staff authentication crypto', () => {
  it('hashes and verifies passwords with salted scrypt', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');

    expect(first).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false);
  });

  it('generates high-entropy opaque tokens and deterministic SHA-256 hashes', () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    expect(hashToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(first)).not.toBe(first);
  });
});
