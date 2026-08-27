/**
 * Refresh offers_snapshot + price_current on published SEO pages (no AI).
 * Phase 14: merge canon peer offers (same as publish) so refresh does not wipe cross-MP;
 * batch prefers is_primary rows (aliases redirect — not separate indexable products).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import type { Marketplace } from './product-url.ts';
import {
  loadOffersSnapshot,
  loadSourcePrice,
  mergeSeoOffers,
  offersFingerprint,
} from './seo-offers.ts';
import type { SeoOfferSnapshot } from './seo-publish-core.ts';
import { seoRevalidatePaths } from './seo-publish-core.ts';
import { seoPublishableIds } from './seo-marketplaces.ts';

const VALID_MPS = new Set(seoPublishableIds());
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export interface SeoRefreshOffersItemResult {
  slug: string;
  productKey: string;
  updated: boolean;
  skipped?: 'unchanged' | 'bad_marketplace' | 'alias';
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

/** Merge freshly loaded offers with published peers under the same canon_id. */
export async function mergeOffersWithCanonPeers(
  supabase: SupabaseClient,
  input: {
    productKey: string;
    canonId: string | null | undefined;
    offers: SeoOfferSnapshot[];
  },
): Promise<SeoOfferSnapshot[]> {
  const canonId = input.canonId?.trim();
  if (!canonId) return mergeSeoOffers(input.offers);

  const { data: peers } = await supabase
    .from('seo_product_pages')
    .select('offers_snapshot')
    .eq('canon_id', canonId)
    .eq('publish_status', 'published')
    .neq('product_key', input.productKey);

  const peerLists = (peers ?? []).map((p) =>
    Array.isArray((p as { offers_snapshot?: unknown }).offers_snapshot)
      ? ((p as { offers_snapshot: SeoOfferSnapshot[] }).offers_snapshot)
      : [],
  );
  return mergeSeoOffers(input.offers, ...peerLists);
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
    canon_id?: string | null;
    is_primary?: boolean | null;
  },
  opts: { skipAliases?: boolean } = {},
): Promise<SeoRefreshOffersItemResult & { paths?: string[] }> {
  if (!VALID_MPS.has(row.marketplace)) {
    return {
      slug: row.slug,
      productKey: row.product_key,
      updated: false,
      skipped: 'bad_marketplace',
    };
  }

  // Aliases 301 to primary — skip in default batch (product/model = primary page)
  if (opts.skipAliases !== false && row.is_primary === false) {
    return {
      slug: row.slug,
      productKey: row.product_key,
      updated: false,
      skipped: 'alias',
    };
  }

  const marketplace = row.marketplace as Marketplace;
  const scrape = await loadSourcePrice(supabase, marketplace, row.product_id);
  const loaded = await loadOffersSnapshot(supabase, marketplace, row.product_id);
  const offers = await mergeOffersWithCanonPeers(supabase, {
    productKey: row.product_key,
    canonId: row.canon_id,
    offers: loaded,
  });

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

  // Keep alias peers in sync with primary offer set (no separate seller pages)
  if (row.canon_id && row.is_primary !== false) {
    await supabase
      .from('seo_product_pages')
      .update({ offers_snapshot: offers, updated_at: nowIso })
      .eq('canon_id', row.canon_id)
      .eq('publish_status', 'published')
      .eq('is_primary', false);
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
    /** When true, also refresh alias rows (default false — product/model = primary) */
    includeAliases?: boolean;
  } = {},
): Promise<SeoRefreshOffersBatchResult> {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(Number(opts.limit) || DEFAULT_LIMIT)),
  );
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const includeAliases = Boolean(opts.includeAliases);

  let query = supabase
    .from('seo_product_pages')
    .select(
      'slug, product_key, marketplace, product_id, brand_slug, category_slug, offers_snapshot, price_current, product_url, canon_id, is_primary',
    )
    .eq('publish_status', 'published');

  if (!includeAliases && !opts.slug?.trim() && !opts.productKey?.trim()) {
    query = query.eq('is_primary', true);
  }

  if (opts.slug?.trim()) {
    query = query.eq('slug', opts.slug.trim());
  } else if (opts.productKey?.trim()) {
    query = query.eq('product_key', opts.productKey.trim());
  } else {
    query = query
      .order('updated_at', { ascending: true, nullsFirst: true })
      .range(offset, offset + limit - 1);
  }

  let { data, error } = await query;
  if (error && /is_primary|canon_id|column/i.test(error.message)) {
    let fallback = supabase
      .from('seo_product_pages')
      .select(
        'slug, product_key, marketplace, product_id, brand_slug, category_slug, offers_snapshot, price_current, product_url',
      )
      .eq('publish_status', 'published');
    if (opts.slug?.trim()) fallback = fallback.eq('slug', opts.slug.trim());
    else if (opts.productKey?.trim()) {
      fallback = fallback.eq('product_key', opts.productKey.trim());
    } else {
      fallback = fallback
        .order('updated_at', { ascending: true, nullsFirst: true })
        .range(offset, offset + limit - 1);
    }
    const retry = await fallback;
    data = retry.data;
    error = retry.error;
  }

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
      canon_id?: string | null;
      is_primary?: boolean | null;
    };
    const result = await refreshOffersForRow(supabase, row, {
      skipAliases: !includeAliases,
    });
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
