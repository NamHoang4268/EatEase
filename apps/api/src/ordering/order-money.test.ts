import { describe, expect, it } from 'vitest';
import { addVnd, checkedVnd, lineAmount, MAX_VND_AMOUNT } from './order-money.js';

describe('integer-safe VND persistence arithmetic', () => {
  it('preserves precision above the JavaScript safe integer boundary', () => {
    expect(lineAmount(9_007_199_254_740_993n, 3)).toBe(27_021_597_764_222_979n);
    expect(addVnd([9_007_199_254_740_993n, 1n])).toBe(9_007_199_254_740_994n);
  });

  it('supports zero-priced items and the signed BIGINT upper boundary', () => {
    expect(lineAmount(0n, 2)).toBe(0n);
    expect(checkedVnd(MAX_VND_AMOUNT)).toBe(MAX_VND_AMOUNT);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid quantity %s',
    (quantity) => expect(() => lineAmount(1n, quantity)).toThrow(RangeError),
  );

  it('rejects negative prices and line/subtotal overflow before persistence', () => {
    expect(() => lineAmount(-1n, 1)).toThrow(RangeError);
    expect(() => lineAmount(MAX_VND_AMOUNT, 2)).toThrow(RangeError);
    expect(() => addVnd([MAX_VND_AMOUNT, 1n])).toThrow(RangeError);
  });
});
