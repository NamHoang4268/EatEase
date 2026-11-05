import { describe, expect, it } from 'vitest';
import { assertLocalE2eDatabase } from '../e2e/local-target.js';

describe('E2E database guard', () => {
  it('allows only the named local test database or explicit ephemeral CI', () => {
    expect(
      assertLocalE2eDatabase({
        DATABASE_URL: 'postgresql://local:local@localhost:5432/eatease_m2_test',
      }),
    ).toBe('eatease_m2_test');
    expect(
      assertLocalE2eDatabase({
        DATABASE_URL: 'postgresql://local:local@127.0.0.1/eatease',
        CI: 'true',
      }),
    ).toBe('eatease');
  });
  it.each([
    'postgresql://local:local@neon.example/eatease_m2_test',
    'postgresql://local:local@localhost/eatease',
    'postgresql://local:local@localhost/production',
    'not-a-valid-url',
  ])('rejects unsafe targets without echoing credentials', (url) => {
    expect(() => assertLocalE2eDatabase({ DATABASE_URL: url })).toThrow(/E2E|isolated/);
  });
});
