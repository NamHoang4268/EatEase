import { describe, expect, it } from 'vitest';
import { LOGIN_FAILURE_WINDOW_MS } from './auth.constants.js';
import { LoginRateLimiterService } from './login-rate-limiter.service.js';

describe('LoginRateLimiterService', () => {
  it('allows five failures and blocks subsequent attempts within the window', () => {
    const limiter = new LoginRateLimiterService();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.isBlocked('person@example.com\u0000127.0.0.1', 1_000)).toBe(false);
      limiter.recordFailure('person@example.com\u0000127.0.0.1', 1_000);
    }
    expect(limiter.isBlocked('person@example.com\u0000127.0.0.1', 1_001)).toBe(true);
  });

  it('expires failures after fifteen minutes and isolates keys', () => {
    const limiter = new LoginRateLimiterService();
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure('first', 1_000);

    expect(limiter.isBlocked('second', 1_001)).toBe(false);
    expect(limiter.isBlocked('first', 1_000 + LOGIN_FAILURE_WINDOW_MS)).toBe(false);
  });
});
