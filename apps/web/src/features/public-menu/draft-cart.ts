import type { PublicMenuItem } from './public-menu.types';

export const MAX_DRAFT_QUANTITY = 99;

export type DraftCartLine = {
  menuItemId: string;
  name: string;
  unitPriceAmount: string;
  quantity: number;
};

export function addDraftItem(cart: DraftCartLine[], item: PublicMenuItem): DraftCartLine[] {
  if (!item.available) {
    return cart;
  }

  const existing = cart.find((line) => line.menuItemId === item.id);
  if (!existing) {
    return [
      ...cart,
      {
        menuItemId: item.id,
        name: item.name,
        unitPriceAmount: item.priceAmount,
        quantity: 1,
      },
    ];
  }

  if (existing.quantity >= MAX_DRAFT_QUANTITY) {
    return cart;
  }

  return cart.map((line) =>
    line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
  );
}

export function changeDraftQuantity(
  cart: DraftCartLine[],
  menuItemId: string,
  change: -1 | 1,
): DraftCartLine[] {
  const existing = cart.find((line) => line.menuItemId === menuItemId);
  if (!existing) {
    return cart;
  }

  const nextQuantity = existing.quantity + change;
  if (nextQuantity <= 0) {
    return cart.filter((line) => line.menuItemId !== menuItemId);
  }

  if (!Number.isSafeInteger(nextQuantity) || nextQuantity > MAX_DRAFT_QUANTITY) {
    return cart;
  }

  return cart.map((line) =>
    line.menuItemId === menuItemId ? { ...line, quantity: nextQuantity } : line,
  );
}

export function removeDraftItem(cart: DraftCartLine[], menuItemId: string): DraftCartLine[] {
  return cart.filter((line) => line.menuItemId !== menuItemId);
}

export function calculateDraftSubtotal(cart: DraftCartLine[]): bigint {
  return cart.reduce(
    (subtotal, line) => subtotal + BigInt(line.unitPriceAmount) * BigInt(line.quantity),
    0n,
  );
}

export function formatVnd(amount: bigint): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}
