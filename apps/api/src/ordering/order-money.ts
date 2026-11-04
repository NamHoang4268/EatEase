export const MAX_VND_AMOUNT = 9_223_372_036_854_775_807n;

export function checkedVnd(amount: bigint): bigint {
  if (amount < 0n || amount > MAX_VND_AMOUNT) {
    throw new RangeError('VND amount is outside nonnegative PostgreSQL BIGINT range.');
  }
  return amount;
}

export function lineAmount(unitAmount: bigint, quantity: number): bigint {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2_147_483_647) {
    throw new RangeError('Quantity must be a positive PostgreSQL INTEGER.');
  }
  return checkedVnd(checkedVnd(unitAmount) * BigInt(quantity));
}

export function addVnd(amounts: readonly bigint[]): bigint {
  return amounts.reduce((sum, amount) => checkedVnd(sum + checkedVnd(amount)), 0n);
}
