export type PublicTableAvailability = 'AVAILABLE' | 'BROWSE_ONLY' | 'UNAVAILABLE';

export type PublicTableContext = {
  publicId: string;
  restaurantName: string;
  locationName: string;
  tableLabel: string;
  capacity: number;
  availability: PublicTableAvailability;
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: string;
  currency: 'VND';
  fulfillmentStation: 'KITCHEN' | 'BAR' | 'DIRECT';
  available: true;
};

export type PublicMenuCategory = {
  id: string;
  name: string;
  items: PublicMenuItem[];
};

export type PublicMenu = {
  currency: 'VND';
  categories: PublicMenuCategory[];
};
