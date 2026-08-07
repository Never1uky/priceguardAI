/**
 * Shared product_cache get/put so ai-proxy / product-cache / product-intel
 * share the same upsert conflict key and TTL semantics.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export const PRODUCT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Sonar web-research (v3): longer shared TTL — one research per SKU for all users */
export const WEB_RESEARCH_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const WEB_RESEARCH_CACHE_VERSION = 3;
export const FULL_PRODUCT_CACHE_VERSION = 2;
export const REVIEWS_CACHE_VERSION = 1;

export function isProductCacheFresh(
  lastUpdated: string | null | undefined,
  ttlMs = PRODUCT_CACHE_TTL_MS,
): boolean {
  if (!lastUpdated) return false;
  const ts = Date.parse(lastUpdated);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < ttlMs;
}

export type ProductCacheRow = {
  marketplace: string;
  product_id: string;
  product_title?: string | null;
  model?: string | null;
  raw_reviews?: unknown;
  ai_analysis?: unknown;
  last_updated?: string;
  cache_version: number;
};

export async function getProductCacheEntry(
  supabase: SupabaseClient,
  marketplace: string,
  productId: string,
  cacheVersion: number,
  ttlMs = PRODUCT_CACHE_TTL_MS,
): Promise<ProductCacheRow | null> {
  const { data, error } = await supabase
    .from('product_cache')
    .select(
      'marketplace, product_id, product_title, model, raw_reviews, ai_analysis, last_updated, cache_version',
    )
    .eq('marketplace', marketplace)
    .eq('product_id', productId)
    .eq('cache_version', cacheVersion)
    .maybeSingle();

  if (error) {
    console.error('[product-cache-store] get', error);
    return null;
  }
  if (!data) return null;
  if (!isProductCacheFresh(data.last_updated, ttlMs)) return null;
  return data as ProductCacheRow;
}

export async function upsertProductCacheVersioned(
  supabase: SupabaseClient,
  row: {
    marketplace: string;
    productId: string;
    productTitle?: string | null;
    model?: string | null;
    rawReviews?: unknown;
    aiAnalysis?: unknown;
    cacheVersion: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    marketplace: row.marketplace,
    product_id: row.productId,
    product_title: row.productTitle ? String(row.productTitle).slice(0, 500) : null,
    model: row.model ? String(row.model).slice(0, 64) : null,
    raw_reviews: row.rawReviews ?? null,
    ai_analysis: row.aiAnalysis ?? null,
    last_updated: new Date().toISOString(),
    cache_version: row.cacheVersion,
  };

  const { error } = await supabase
    .from('product_cache')
    .upsert(payload, { onConflict: 'marketplace,product_id,cache_version' });

  if (error) {
    console.error('[product-cache-store] upsert', error);
    return { ok: false, error: error.message };
  }

  // Fire-and-forget SEO snapshot for full analysis only (v2). Never blocks / never AI.
  if (row.cacheVersion === FULL_PRODUCT_CACHE_VERSION) {
    void import('./seo-publish-run.ts')
      .then(({ scheduleSeoPublishAfterV2Upsert }) => {
        scheduleSeoPublishAfterV2Upsert(
          supabase,
          row.marketplace,
          row.productId,
          row.cacheVersion,
        );
      })
      .catch((e) => {
        console.warn('[seo-publish] schedule failed', e);
      });
  }

  return { ok: true };
}

/** Mark AI full-analysis (v2) and reviews (v1) stale so clients refetch. */
export async function invalidateProductCacheAnalysis(
  supabase: SupabaseClient,
  marketplace: string,
  productId: string,
  versions: number[] = [FULL_PRODUCT_CACHE_VERSION, REVIEWS_CACHE_VERSION],
): Promise<void> {
  const epoch = new Date(0).toISOString();
  const { error } = await supabase
    .from('product_cache')
    .update({ last_updated: epoch })
    .eq('marketplace', marketplace)
    .eq('product_id', productId)
    .in('cache_version', versions);

  if (error) {
    console.warn('[product-cache-store] invalidate', error);
  }
}
