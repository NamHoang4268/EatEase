import { describe, expect, it } from 'vitest';
import { JOIN_CODE_TTL_MS, JOIN_RECOVERY_TTL_MS } from './join-code.constants.js';

describe('approved Join Code durations', () => {
  it('keeps the Join Code lifetime fixed at exactly 30 minutes', () => {
    expect(JOIN_CODE_TTL_MS).toBe(1_800_000);
  });

  it('keeps credential recovery fixed at exactly 120 seconds', () => {
    expect(JOIN_RECOVERY_TTL_MS).toBe(120_000);
  });
});
