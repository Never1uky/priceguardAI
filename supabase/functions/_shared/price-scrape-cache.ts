/**
 * Shared price scrape cache (TTL 6h) for update-prices / Scrappey / client unlocker.
 * Keys are always bare product_id (no wb-/ozon-/ym- prefix) so cron + /add share hits.
 * Megamarket / AliExpress: bare digits goods/item id (no marketplace prefix).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { productIdLookupCandidates, stripProductIdPrefix } from './product-id.ts';
import type { Marketplace as CoreMarketplace } from './product-url.ts';

export const PRICE_SCRAPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type CacheMarketplace = CoreMarketplace | 'megamarket' | 'aliexpress';
export type CacheWriteSource = 'scrappey' | 'legacy';

export interface CachedFetchedPrice {
  price: number;
  title?: string;
  url: string;
  source: 'cache';
}

/** Bare SKU key for price_scrape_cache PK. */
export function bareCacheProductId(
  marketplace: CacheMarketplace,
  productId: string,
): string {
  if (marketplace === 'megamarket') {
    const digits = productId.replace(/\D/g, '');
    return digits.length >= 6 ? digits : productId.trim();
  }
  if (marketplace === 'aliexpress') {
    const digits = productId.replace(/\D/g, '');
    return digits.length >= 8 ? digits : productId.trim();
  }
  return stripProductIdPrefix(marketplace, productId);
}

function cacheLookupIds(marketplace: CacheMarketplace, productId: string): string[] {
  if (marketplace === 'megamarket' || marketplace === 'aliexpress') {
    const bare = bareCacheProductId(marketplace, productId);
    return bare ? [bare] : [];
  }
  const bare = stripProductIdPrefix(marketplace, productId);
  const candidates = productIdLookupCandidates(marketplace, productId);
  return [...new Set([bare, ...candidates].filter(Boolean))];
}

function cacheRowFresh(
  data: { price: unknown; title?: unknown; url?: unknown; fetched_at?: unknown },
  ttlMs: number = PRICE_SCRAPE_CACHE_TTL_MS,
): CachedFetchedPrice | null {
  const fetchedAt = Date.parse(String(data.fetched_at));
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : PRICE_SCRAPE_CACHE_TTL_MS;
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > ttl) {
    return null;
  }

  const price = Number(data.price);
  if (!price || price <= 0) return null;

  return {
    price,
    title: data.title ? String(data.title) : undefined,
    url: data.url ? String(data.url) : '',
    source: 'cache',
  };
}

export async function getCachedPrice(
  supabase: SupabaseClient,
  marketplace: CacheMarketplace,
  productId: string,
  ttlMs: number = PRICE_SCRAPE_CACHE_TTL_MS,
): Promise<CachedFetchedPrice | null> {
  const ordered = cacheLookupIds(marketplace, productId);

  for (const id of ordered) {
    const { data, error } = await supabase
      .from('price_scrape_cache')
      .select('price, title, url, source, fetched_at')
      .eq('marketplace', marketplace)
      .eq('product_id', id)
      .maybeSingle();

    if (error || !data) continue;
    const hit = cacheRowFresh(data, ttlMs);
    if (hit) return hit;
  }

  return null;
}

export async function setCachedPrice(
  supabase: SupabaseClient,
  marketplace: CacheMarketplace,
  productId: string,
  fetched: { price: number; title?: string; url: string },
  source: CacheWriteSource,
): Promise<void> {
  const bareId = bareCacheProductId(marketplace, productId);
  if (!bareId) return;

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('price_scrape_cache').upsert(
    {
      marketplace,
      product_id: bareId,
      price: fetched.price,
      title: fetched.title ?? null,
      url: fetched.url,
      source,
      fetched_at: nowIso,
    },
    { onConflict: 'marketplace,product_id' },
  );
  if (error) {
    console.warn('[price_scrape_cache] upsert', error.message);
  }
}
