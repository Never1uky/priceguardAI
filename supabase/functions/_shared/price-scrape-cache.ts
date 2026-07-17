/**
 * Shared price scrape cache (TTL 2h) for update-prices / Bright Data.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export const PRICE_SCRAPE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export type CacheMarketplace = 'wildberries' | 'ozon' | 'yandex_market';
export type CacheWriteSource = 'brightdata' | 'legacy';

export interface CachedFetchedPrice {
  price: number;
  title?: string;
  url: string;
  source: 'cache';
}

export async function getCachedPrice(
  supabase: SupabaseClient,
  marketplace: CacheMarketplace,
  productId: string,
): Promise<CachedFetchedPrice | null> {
  const { data, error } = await supabase
    .from('price_scrape_cache')
    .select('price, title, url, source, fetched_at')
    .eq('marketplace', marketplace)
    .eq('product_id', productId)
    .maybeSingle();

  if (error || !data) return null;

  const fetchedAt = Date.parse(String(data.fetched_at));
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > PRICE_SCRAPE_CACHE_TTL_MS) {
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

export async function setCachedPrice(
  supabase: SupabaseClient,
  marketplace: CacheMarketplace,
  productId: string,
  fetched: { price: number; title?: string; url: string },
  source: CacheWriteSource,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('price_scrape_cache').upsert(
    {
      marketplace,
      product_id: productId,
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
