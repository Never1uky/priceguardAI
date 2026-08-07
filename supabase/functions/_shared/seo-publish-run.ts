/**
 * Core SEO publish from product_cache v2 (no AI).
 * Used by Edge `seo-publish` HTTP handler and fire-and-forget cache hooks.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { FULL_PRODUCT_CACHE_VERSION } from './product-cache-store.ts';
import {
  productIdLookupCandidates,
  productKey as bareProductKey,
  stripProductIdPrefix,
} from './product-id.ts';
import type { Marketplace } from './product-url.ts';
import { evaluateSeoPublishGates } from './seo-gates.ts';
import {
  brandOrCategorySlug,
  buildSeoProductSlug,
  canonicalPathForSlug,
  guessBrandModelFromTitle,
  hashSeoAnalysis,
} from './seo-slug.ts';
import {
  allocateUniqueSlug,
  analyzedAtToIso,
  asAnalysisRecord,
  countRawReviews,
  seoRevalidatePaths,
  type SeoOfferSnapshot,
  type SeoPublishResult,
} from './seo-publish-core.ts';
import { loadOffersSnapshot, loadSourcePrice } from './seo-offers.ts';

const VALID_MPS = new Set(['wildberries', 'ozon', 'yandex_market']);

async function loadCacheV2(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
): Promise<{
  productId: string;
  title: string | null;
  rawReviews: unknown;
  analysis: Record<string, unknown>;
  lastUpdated: string | null;
} | null> {
  const candidates = productIdLookupCandidates(marketplace, productId);
  for (const id of candidates) {
    const { data, error } = await supabase
      .from('product_cache')
      .select('product_id, product_title, raw_reviews, ai_analysis, last_updated')
      .eq('marketplace', marketplace)
      .eq('product_id', id)
      .eq('cache_version', FULL_PRODUCT_CACHE_VERSION)
      .maybeSingle();

    if (error || !data?.ai_analysis) continue;
    const analysis = asAnalysisRecord(data.ai_analysis);
    if (!analysis) continue;
    return {
      productId: String(data.product_id),
      title: data.product_title ? String(data.product_title) : null,
      rawReviews: data.raw_reviews,
      analysis,
      lastUpdated: data.last_updated ? String(data.last_updated) : null,
    };
  }
  return null;
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
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) {
      console.warn('[seo-publish] revalidate HTTP', res.status);
    }
  } catch (e) {
    console.warn('[seo-publish] revalidate failed', e);
  }
}

export async function runSeoPublish(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productIdRaw: string,
): Promise<SeoPublishResult> {
  const bareId = stripProductIdPrefix(marketplace, productIdRaw);
  if (!bareId) {
    return { ok: false, skipped: 'missing_cache', rejectReason: 'invalid_product_id' };
  }

  const key = bareProductKey(marketplace, bareId);
  const cache = await loadCacheV2(supabase, marketplace, bareId);
  if (!cache) {
    return { ok: true, skipped: 'missing_cache' };
  }

  const analysis = cache.analysis;
  const reviewCount = countRawReviews(cache.rawReviews);
  const analysisHash = await hashSeoAnalysis(analysis);

  const { data: existing } = await supabase
    .from('seo_product_pages')
    .select('id, slug, brand_slug, category_slug, analysis_hash, publish_status')
    .eq('product_key', key)
    .maybeSingle();

  if (existing?.analysis_hash === analysisHash && existing.publish_status === 'published') {
    return {
      ok: true,
      slug: existing.slug,
      skipped: 'unchanged',
      published: true,
    };
  }

  const gate = evaluateSeoPublishGates({
    analysis: {
      qualityScore: analysis.qualityScore as number,
      qualitySummary: analysis.qualitySummary as string,
      verdictExplanation: analysis.verdictExplanation as string,
      verdict: analysis.verdict as string,
      fakeRisk: analysis.fakeRisk as string,
      webOverview: (analysis.webOverview as string) ?? '',
      source: (analysis.source as string) ?? '',
    },
    reviewCount,
  });

  if (!gate.ok) {
    if (existing?.publish_status === 'published') {
      return {
        ok: true,
        slug: existing.slug,
        skipped: 'rejected',
        rejectReason: gate.reason,
        published: true,
      };
    }

    const title = cache.title?.trim() || `${marketplace} ${bareId}`;
    const guessed = guessBrandModelFromTitle(title);
    const desired = buildSeoProductSlug({
      brand: guessed.brand,
      model: guessed.model,
      marketplace,
      productId: bareId,
    });
    const slug = existing?.slug
      ?? await allocateUniqueSlug({
        desired,
        marketplace,
        productId: bareId,
        productKey: key,
        isTakenByOther: async (s) => {
          const { data } = await supabase
            .from('seo_product_pages')
            .select('product_key')
            .eq('slug', s)
            .maybeSingle();
          return Boolean(data && data.product_key !== key);
        },
      });

    const brand = guessed.brand ?? null;
    const brandSlug = brandOrCategorySlug(brand);
    const row = {
      slug,
      canonical_path: canonicalPathForSlug(slug),
      marketplace,
      product_id: bareId,
      product_key: key,
      title,
      brand,
      brand_slug: brandSlug,
      category: null as string | null,
      category_slug: null as string | null,
      analysis_snapshot: analysis,
      analysis_hash: analysisHash,
      analyzed_at: analyzedAtToIso(analysis),
      offers_snapshot: [] as SeoOfferSnapshot[],
      price_current: null as number | null,
      image_url: null as string | null,
      product_url: null as string | null,
      quality_score: typeof analysis.qualityScore === 'number' ? analysis.qualityScore : null,
      review_count: reviewCount,
      publish_status: 'rejected',
      reject_reason: gate.reason ?? 'rejected',
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('seo_product_pages').upsert(row, {
      onConflict: 'product_key',
    });
    if (error) {
      console.error('[seo-publish] reject upsert', error);
      return { ok: false, rejectReason: error.message };
    }
    return {
      ok: true,
      slug,
      skipped: 'rejected',
      rejectReason: gate.reason,
    };
  }

  const title = cache.title?.trim() || `${marketplace} ${bareId}`;
  const guessed = guessBrandModelFromTitle(title);
  const brand = guessed.brand ?? null;
  const brandSlug = brandOrCategorySlug(brand);
  const category: string | null = null;
  const categorySlug = brandOrCategorySlug(category);

  const desired = buildSeoProductSlug({
    brand: guessed.brand,
    model: guessed.model,
    marketplace,
    productId: bareId,
  });

  const slug = existing?.slug
    ?? await allocateUniqueSlug({
      desired,
      marketplace,
      productId: bareId,
      productKey: key,
      isTakenByOther: async (s) => {
        const { data } = await supabase
          .from('seo_product_pages')
          .select('product_key')
          .eq('slug', s)
          .maybeSingle();
        return Boolean(data && data.product_key !== key);
      },
    });

  const scrape = await loadSourcePrice(supabase, marketplace, bareId);
  const offers = await loadOffersSnapshot(supabase, marketplace, bareId);
  const nowIso = new Date().toISOString();
  const publishedAt = existing?.publish_status === 'published' ? undefined : nowIso;

  const row: Record<string, unknown> = {
    slug,
    canonical_path: canonicalPathForSlug(slug),
    marketplace,
    product_id: bareId,
    product_key: key,
    title,
    brand,
    brand_slug: brandSlug,
    category,
    category_slug: categorySlug,
    analysis_snapshot: analysis,
    analysis_hash: analysisHash,
    analyzed_at: analyzedAtToIso(analysis) ?? cache.lastUpdated,
    offers_snapshot: offers,
    price_current: scrape.price,
    image_url: null,
    product_url: scrape.url,
    quality_score: analysis.qualityScore,
    review_count: reviewCount,
    publish_status: 'published',
    reject_reason: null,
    updated_at: nowIso,
  };
  if (publishedAt) row.published_at = publishedAt;

  const { error } = await supabase.from('seo_product_pages').upsert(row, {
    onConflict: 'product_key',
  });
  if (error) {
    console.error('[seo-publish] publish upsert', error);
    return { ok: false, rejectReason: error.message };
  }

  const paths = seoRevalidatePaths(slug, brandSlug, categorySlug);
  await notifyRevalidate(paths);

  return {
    ok: true,
    slug,
    published: true,
    revalidatePaths: paths,
  };
}

/** Fire-and-forget after product_cache v2 upsert. Never throws to caller. */
export function scheduleSeoPublishAfterV2Upsert(
  supabase: SupabaseClient,
  marketplace: string,
  productId: string,
  cacheVersion: number,
): void {
  if (cacheVersion !== FULL_PRODUCT_CACHE_VERSION) return;
  if (!VALID_MPS.has(marketplace) || !productId.trim()) return;

  void runSeoPublish(supabase, marketplace as Marketplace, productId)
    .then((r) => {
      const id = `${marketplace}:${productId}`;
      if (r.skipped === 'unchanged' || r.skipped === 'missing_cache') {
        console.info('[seo-publish] skipped', r.skipped, id, r.slug ?? '');
      } else if (r.skipped === 'rejected') {
        console.info('[seo-publish] rejected', r.rejectReason ?? '', id, r.slug ?? '');
      } else if (r.ok && r.published) {
        console.info('[seo-publish] ok', id, r.slug ?? '');
      } else {
        console.info('[seo-publish] failed', id, r.rejectReason ?? '');
      }
    })
    .catch((e) => {
      console.warn('[seo-publish] error', marketplace, productId, e);
    });
}
