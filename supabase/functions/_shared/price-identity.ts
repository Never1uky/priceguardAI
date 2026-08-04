/**
 * Identity checks for server-side price updates / Telegram alerts.
 * Keep in sync with extension src/lib/price-identity.ts (marketplace + article/URL).
 */

import { extractProductId, type Marketplace } from './product-url.ts';
import { stripProductIdPrefix } from './product-id.ts';

export function bareTrackedProductId(
  marketplace: Marketplace,
  productId: string,
): string {
  return stripProductIdPrefix(marketplace, productId);
}

/** Fetched price belongs to the tracked row SKU. */
export function fetchedPriceMatchesTracked(input: {
  marketplace: Marketplace;
  productId: string;
  productUrl?: string | null;
  fetchedUrl?: string | null;
  fetchedTitle?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const expected = bareTrackedProductId(input.marketplace, input.productId);
  if (!expected) {
    return { ok: false, reason: 'missing_row_product_id' };
  }

  const urls = [input.fetchedUrl, input.productUrl].filter(
    (u): u is string => Boolean(u && u.startsWith('http')),
  );

  for (const url of urls) {
    const fromUrl = extractProductId(url, input.marketplace);
    if (fromUrl && fromUrl !== expected) {
      return { ok: false, reason: 'url_product_id_mismatch' };
    }
  }

  // Prefer a positive confirmation when URL carries an id
  if (input.fetchedUrl?.startsWith('http')) {
    const fromFetched = extractProductId(input.fetchedUrl, input.marketplace);
    if (fromFetched && fromFetched === expected) {
      return { ok: true };
    }
    if (fromFetched && fromFetched !== expected) {
      return { ok: false, reason: 'fetched_url_mismatch' };
    }
  }

  // WB/API fetches often reconstruct URL from productId — OK if we requested by that id
  if (input.productUrl?.startsWith('http')) {
    const fromRow = extractProductId(input.productUrl, input.marketplace);
    if (fromRow && fromRow !== expected) {
      return { ok: false, reason: 'row_url_mismatch' };
    }
  }

  return { ok: true };
}

export function logPriceIdentityReject(payload: Record<string, unknown>): void {
  console.warn('[PriceGuard] price-identity reject', payload);
}
