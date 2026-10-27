export type PublicTableContext = {
  publicId: string;
  restaurantName: string;
  locationName: string;
  tableLabel: string;
  capacity: number;
  availability: 'AVAILABLE' | 'BROWSE_ONLY' | 'UNAVAILABLE';
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: string;
  currency: 'VND';
  fulfillmentStation: 'KITCHEN' | 'BAR' | 'DIRECT';
  available: boolean;
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
