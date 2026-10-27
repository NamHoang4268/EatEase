import { describe, expect, it } from 'vitest';
import {
  addDraftItem,
  calculateDraftSubtotal,
  changeDraftQuantity,
  removeDraftItem,
} from './draft-cart';
import type { PublicMenuItem } from './public-menu.types';

const availableItem: PublicMenuItem = {
  id: 'item-1',
  name: 'Cơm gà lá chanh',
  description: null,
  priceAmount: '79000',
  currency: 'VND',
  fulfillmentStation: 'KITCHEN',
  available: true,
};

describe('draft cart', () => {
  it('adds items, changes quantities and calculates an integer-safe subtotal', () => {
    const one = addDraftItem([], availableItem);
    const two = addDraftItem(one, availableItem);
    const three = changeDraftQuantity(two, availableItem.id, 1);

    expect(three[0]?.quantity).toBe(3);
    expect(calculateDraftSubtotal(three)).toBe(237_000n);
    expect(changeDraftQuantity(three, availableItem.id, -1)[0]?.quantity).toBe(2);
  });

  it('removes lines explicitly or when quantity reaches zero', () => {
    const cart = addDraftItem([], availableItem);
    expect(changeDraftQuantity(cart, availableItem.id, -1)).toEqual([]);
    expect(removeDraftItem(cart, availableItem.id)).toEqual([]);
  });

  it('does not add unavailable items', () => {
    expect(addDraftItem([], { ...availableItem, available: false })).toEqual([]);
  });
});
