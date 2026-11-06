// Single source of truth: the API's domain contracts (docs/3_SCHEMAS.md). Type-only, erased at build.
export type * from '../../../api/src/domain/types.js';

export interface PublicProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  unit: string;
  imageUrl: string | null;
  attributes: Record<string, string>;
  categoryId: string | null;
  inStock: boolean;
  available: number;
}

export interface PublicCatalog {
  settings: { businessName: string; currency: string; whatsappNumber: string };
  products: PublicProduct[];
}

export interface ChannelStatus { name: 'whatsapp' | 'messenger' | 'instagram' | 'telegram'; configured: boolean }
