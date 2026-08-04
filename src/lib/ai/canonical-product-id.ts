/**
 * Stable product identity helpers for AI cache indexing / telemetry.
 * Not a replacement for marketplace+productId in product_cache rows.
 */

import type { ProductFeatures } from '@/lib/product-features';
import type { Marketplace } from '@/types/product';

function normPart(s: string | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[().,]/g, '')
    .trim();
}

/** Per-marketplace SKU identity (existing pattern). */
export function sameSkuId(marketplace: Marketplace | string, productId: string): string {
  return `${marketplace}:${String(productId).trim()}`;
}

/**
 * Content-based canonical id when brand+model are present.
 * Returns null for weak titles (do not invent unstable canons).
 */
export function canonicalProductId(
  features: Pick<ProductFeatures, 'brand' | 'model' | 'storage' | 'category' | 'title'>,
): string | null {
  const brand = normPart(features.brand);
  const model = normPart(features.model);
  if (!brand || !model) return null;

  const storage = normPart(features.storage);
  const category = features.category ? String(features.category) : '';
  const parts = [brand, model, storage, category].filter(Boolean);
  return `canon:${parts.join('|')}`.slice(0, 160);
}
