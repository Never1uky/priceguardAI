/**
 * Refresh offers_snapshot + price_current on published SEO pages (no AI).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import type { Marketplace } from './product-url.ts';
import {
  loadOffersSnapshot,
  loadSourcePrice,
  offersFingerprint,
} from './seo-offers.ts';
import { seoRevalidatePaths } from './seo-publish-core.ts';

const VALID_MPS = new Set(['wildberries', 'ozon', 'yandex_market']);
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export interface SeoRefreshOffersItemResult {
  slug: string;
  productKey: string;
  updated: boolean;
  skipped?: 'unchanged' | 'bad_marketplace';
  error?: string;
}

export interface SeoRefreshOffersBatchResult {
  ok: boolean;
  scanned: number;
  updated: number;
  unchanged: number;
  errors: number;
  items: SeoRefreshOffersItemResult[];
  revalidatePaths: string[];
}

async function notifyRevalidate(paths: string[]): Promise<void> {
  const origin = Deno.env.get('SEO_SITE_ORIGIN')?.trim().replace(/\/$/, '');
  const secret = Deno.env.get('SEO_REVALIDATE_SECRET')?.trim();
  if (!origin || !secret || paths.length === 0) return;
  try {
    const res = await fetch(`${origin}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': secret,
      },
      body: JSON.stringify({ paths: [...new Set(paths)] }),
    });
    if (!res.ok) {
      console.warn('[seo-refresh-offers] revalidate HTTP', res.status);
    }
  } catch (e) {
    console.warn('[seo-refresh-offers] revalidate failed', e);
  }
}

export async function refreshOffersForRow(
  supabase: SupabaseClient,
  row: {
    slug: string;
    product_key: string;
    marketplace: string;
    product_id: string;
    brand_slug: string | null;
    category_slug: string | null;
    offers_snapshot: unknown;
    price_current: number | null;
    product_url: string | null;
  },
): Promise<SeoRefreshOffersItemResult & { paths?: string[] }> {
  if (!VALID_MPS.has(row.marketplace)) {
    return {
      slug: row.slug,
      productKey: row.product_key,
      updated: false,
      skipped: 'bad_marketplace',
    };
  }

  const marketplace = row.marketplace as Marketplace;
  const scrape = await loadSourcePrice(supabase, marketplace, row.product_id);
  const offers = await loadOffersSnapshot(supabase, marketplace, row.product_id);

  const before = offersFingerprint(row.offers_snapshot, row.price_current, row.product_url);
  const after = offersFingerprint(offers, scrape.price, scrape.url ?? row.product_url);
  if (before === after) {
    return {
      slug: row.slug,
      productKey: row.product_key,
      updated: false,
      skipped: 'unchanged',
    };
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    offers_snapshot: offers,
    price_current: scrape.price,
    updated_at: nowIso,
  };
  if (scrape.url) patch.product_url = scrape.url;

  const { error } = await supabase
    .from('seo_product_pages')
    .update(patch)
    .eq('product_key', row.product_key)
    .eq('publish_status', 'published');

  if (error) {
    console.error('[seo-refresh-offers] update', row.product_key, error.message);
    return {
      slug: row.slug,
      productKey: row.product_key,
      updated: false,
      error: error.message,
    };
  }

  const paths = seoRevalidatePaths(row.slug, row.brand_slug, row.category_slug);
  return {
    slug: row.slug,
    productKey: row.product_key,
    updated: true,
    paths,
  };
}

export async function runSeoRefreshOffersBatch(
  supabase: SupabaseClient,
  opts: {
    limit?: number;
    offset?: number;
    slug?: string;
    productKey?: string;
  } = {},
): Promise<SeoRefreshOffersBatchResult> {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(Number(opts.limit) || DEFAULT_LIMIT)),
  );
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));

  let query = supabase
    .from('seo_product_pages')
    .select(
      'slug, product_key, marketplace, product_id, brand_slug, category_slug, offers_snapshot, price_current, product_url',
    )
    .eq('publish_status', 'published');

  if (opts.slug?.trim()) {
    query = query.eq('slug', opts.slug.trim());
  } else if (opts.productKey?.trim()) {
    query = query.eq('product_key', opts.productKey.trim());
  } else {
    // Stale-first: oldest updated_at among published
    query = query
      .order('updated_at', { ascending: true, nullsFirst: true })
      .range(offset, offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[seo-refresh-offers] list', error.message);
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      unchanged: 0,
      errors: 1,
      items: [{ slug: '', productKey: '', updated: false, error: error.message }],
      revalidatePaths: [],
    };
  }

  const rows = data ?? [];
  const items: SeoRefreshOffersItemResult[] = [];
  const revalidatePaths: string[] = [];
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const raw of rows) {
    const row = raw as {
      slug: string;
      product_key: string;
      marketplace: string;
      product_id: string;
      brand_slug: string | null;
      category_slug: string | null;
      offers_snapshot: unknown;
      price_current: number | null;
      product_url: string | null;
    };
    const result = await refreshOffersForRow(supabase, row);
    items.push({
      slug: result.slug,
      productKey: result.productKey,
      updated: result.updated,
      skipped: result.skipped,
      error: result.error,
    });
    if (result.error) errors += 1;
    else if (result.updated) {
      updated += 1;
      if (result.paths) revalidatePaths.push(...result.paths);
    } else unchanged += 1;
  }

  if (updated > 0) {
    revalidatePaths.push('/sitemap.xml', '/rss.xml', '/');
    await notifyRevalidate(revalidatePaths);
  }

  return {
    ok: errors === 0,
    scanned: rows.length,
    updated,
    unchanged,
    errors,
    items,
    revalidatePaths: [...new Set(revalidatePaths)],
  };
}
