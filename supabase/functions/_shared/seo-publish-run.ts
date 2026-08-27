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
import { inferSeoCategoryFromTitle } from './seo-category.ts';
import {
  evaluateSeoPublishGates,
  imageUrlFromSeoAnalysis,
  normalizeQualityScoreForSeo,
  pickSeoImageUrl,
  sanitizeSeoProductTitle,
} from './seo-gates.ts';
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
  averageMarketplaceRating,
  countRawReviews,
  seoRevalidatePaths,
  type SeoOfferSnapshot,
  type SeoPublishResult,
} from './seo-publish-core.ts';
import { loadOffersSnapshot, loadSourcePrice, mergeSeoOffers } from './seo-offers.ts';
import {
  buildSeoCanonId,
  chooseSeoPrimary,
  type SeoPeerRow,
} from './seo-canon.ts';
import { seoPublishableIds } from './seo-marketplaces.ts';

const VALID_MPS = new Set(seoPublishableIds());

/** Title for storage: sanitized product name, never marketplace / SEO labels. */
function resolveSeoTitle(raw: string | null | undefined, bareId: string): string {
  const clean = sanitizeSeoProductTitle(raw);
  if (clean) return clean;
  return `Товар ${bareId}`;
}

/**
 * SEO pages must not depend on guessed marketplace CDN images.
 * Keep an already-published https URL; else first honest candidate from analysis.
 */
function resolvePublishedImageUrl(
  existingUrl?: string | null,
  analysis?: Record<string, unknown> | null,
  extra?: string | null,
): string | null {
  return pickSeoImageUrl(existingUrl, extra, imageUrlFromSeoAnalysis(analysis));
}

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
  opts: { featuredOnly?: boolean } = {},
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
    .select(
      'id, slug, brand_slug, category_slug, analysis_hash, publish_status, is_primary, primary_slug, canon_id, quality_score, published_at, offers_snapshot, image_url',
    )
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

  const qualityScore = normalizeQualityScoreForSeo(
    typeof analysis.qualityScore === 'number' ? analysis.qualityScore : null,
  );
  const analysisForStore: Record<string, unknown> = {
    ...analysis,
    ...(qualityScore != null ? { qualityScore } : {}),
  };

  const gate = evaluateSeoPublishGates({
    analysis: {
      qualityScore: qualityScore ?? (analysis.qualityScore as number),
      qualitySummary: analysis.qualitySummary as string,
      verdictExplanation: analysis.verdictExplanation as string,
      verdict: analysis.verdict as string,
      fakeRisk: analysis.fakeRisk as string,
      webOverview: (analysis.webOverview as string) ?? '',
      source: (analysis.source as string) ?? '',
      pros: analysis.pros,
      cons: analysis.cons,
    },
    reviewCount,
    title: cache.title,
    featuredOnly: Boolean(opts.featuredOnly),
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

    const title = resolveSeoTitle(cache.title, bareId);
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
      analysis_snapshot: analysisForStore,
      analysis_hash: analysisHash,
      analyzed_at: analyzedAtToIso(analysis),
      offers_snapshot: [] as SeoOfferSnapshot[],
      price_current: null as number | null,
      image_url: resolvePublishedImageUrl(
        (existing as { image_url?: string | null } | null)?.image_url,
        analysisForStore,
      ),
      product_url: null as string | null,
      quality_score: qualityScore,
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

  const title = resolveSeoTitle(cache.title, bareId);
  const guessed = guessBrandModelFromTitle(title);
  const brand = guessed.brand ?? null;
  const brandSlug = brandOrCategorySlug(brand);
  const catInfo = inferSeoCategoryFromTitle(title);
  const category = catInfo?.labelRu ?? null;
  const categorySlug = catInfo?.slug ?? null;

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
  const rating = averageMarketplaceRating(cache.rawReviews);
  const nowIso = new Date().toISOString();
  const publishedAt = existing?.publish_status === 'published' ? undefined : nowIso;

  const canonId = buildSeoCanonId({ title, brand, category });
  let isPrimary = true;
  let primarySlug: string | null = null;
  let finalOffers: SeoOfferSnapshot[] = offers;
  const revalidateSlugs = new Set<string>([slug]);

  if (canonId) {
    const { data: peersRaw } = await supabase
      .from('seo_product_pages')
      .select(
        'slug, product_key, quality_score, published_at, is_primary, offers_snapshot, publish_status',
      )
      .eq('canon_id', canonId)
      .eq('publish_status', 'published')
      .neq('product_key', key);

    const peerRows = (peersRaw ?? []) as SeoPeerRow[];
    const selfPeer: SeoPeerRow = {
      slug,
      product_key: key,
      quality_score: qualityScore,
      published_at:
        (existing as { published_at?: string } | null)?.published_at ?? nowIso,
      is_primary: (existing as { is_primary?: boolean } | null)?.is_primary ?? true,
      offers_snapshot: offers,
    };

    const peerOfferLists = peerRows.map((p) =>
      Array.isArray(p.offers_snapshot) ? (p.offers_snapshot as SeoOfferSnapshot[]) : [],
    );
    finalOffers = mergeSeoOffers(offers, ...peerOfferLists);

    const primary = chooseSeoPrimary(selfPeer, peerRows);
    if (primary.product_key === key) {
      isPrimary = true;
      primarySlug = null;
      for (const p of peerRows) {
        revalidateSlugs.add(p.slug);
        await supabase
          .from('seo_product_pages')
          .update({
            is_primary: false,
            primary_slug: slug,
            offers_snapshot: finalOffers,
            updated_at: nowIso,
          })
          .eq('product_key', p.product_key);
      }
    } else {
      isPrimary = false;
      primarySlug = primary.slug;
      revalidateSlugs.add(primary.slug);
      await supabase
        .from('seo_product_pages')
        .update({
          is_primary: true,
          primary_slug: null,
          offers_snapshot: finalOffers,
          analysis_snapshot: analysisForStore,
          analysis_hash: analysisHash,
          quality_score: qualityScore,
          updated_at: nowIso,
        })
        .eq('product_key', primary.product_key);
    }
  }

  const row: Record<string, unknown> = {
    slug,
    canonical_path: canonicalPathForSlug(isPrimary ? slug : primarySlug || slug),
    marketplace,
    product_id: bareId,
    product_key: key,
    title,
    brand,
    brand_slug: brandSlug,
    category,
    category_slug: categorySlug,
    analysis_snapshot: analysisForStore,
    analysis_hash: analysisHash,
    analyzed_at: analyzedAtToIso(analysis) ?? cache.lastUpdated,
    offers_snapshot: finalOffers,
    price_current: scrape.price,
    image_url: resolvePublishedImageUrl(
      (existing as { image_url?: string | null } | null)?.image_url,
      analysisForStore,
    ),
    product_url: scrape.url,
    quality_score: qualityScore,
    review_count: reviewCount,
    rating,
    publish_status: 'published',
    reject_reason: null,
    updated_at: nowIso,
    canon_id: canonId,
    is_primary: isPrimary,
    primary_slug: primarySlug,
  };
  if (publishedAt) row.published_at = publishedAt;

  const { error } = await supabase.from('seo_product_pages').upsert(row, {
    onConflict: 'product_key',
  });
  if (error) {
    const msg = String(error.message || '');
    if (/canon_id|is_primary|primary_slug/i.test(msg)) {
      console.warn('[seo-publish] canon columns missing — upsert without grouping fields');
      delete row.canon_id;
      delete row.is_primary;
      delete row.primary_slug;
      const retry = await supabase.from('seo_product_pages').upsert(row, {
        onConflict: 'product_key',
      });
      if (retry.error) {
        console.error('[seo-publish] publish upsert', retry.error);
        return { ok: false, rejectReason: retry.error.message };
      }
    } else {
      console.error('[seo-publish] publish upsert', error);
      return { ok: false, rejectReason: error.message };
    }
  }

  const paths = [
    ...seoRevalidatePaths(slug, brandSlug, categorySlug),
    ...[...revalidateSlugs].filter((s) => s !== slug).map((s) => `/a/${s}`),
  ];
  await notifyRevalidate(paths);

  return {
    ok: true,
    slug: isPrimary ? slug : primarySlug || slug,
    published: true,
    revalidatePaths: paths,
  };
}

/**
 * One-shot / cron: fill category for published rows where category_slug is null.
 * Does not change slugs or re-run AI.
 */
export async function backfillSeoCategories(
  supabase: SupabaseClient,
  limit = 100,
): Promise<{ ok: true; updated: number; scanned: number }> {
  const { data, error } = await supabase
    .from('seo_product_pages')
    .select('id, slug, title, brand_slug, category_slug')
    .eq('publish_status', 'published')
    .is('category_slug', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(500, Math.max(1, limit)));

  if (error) {
    console.error('[seo-publish] backfill-categories', error);
    throw new Error(error.message);
  }

  let updated = 0;
  const rows = data ?? [];
  for (const row of rows) {
    const title = String(row.title ?? '');
    const cat = inferSeoCategoryFromTitle(title);
    if (!cat) continue;
    const { error: upErr } = await supabase
      .from('seo_product_pages')
      .update({
        category: cat.labelRu,
        category_slug: cat.slug,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (upErr) {
      console.warn('[seo-publish] backfill update', row.slug, upErr.message);
      continue;
    }
    updated += 1;
    const paths = seoRevalidatePaths(
      String(row.slug),
      row.brand_slug ? String(row.brand_slug) : null,
      cat.slug,
    );
    await notifyRevalidate(paths);
  }

  return { ok: true, updated, scanned: rows.length };
}

/**
 * Cron batch: publish from product_cache v2 rows not yet published (or stale).
 * AI cost = 0 — only copies existing analysis through gates.
 */
export async function batchPublishFromCacheV2(
  supabase: SupabaseClient,
  opts: { limit?: number; featuredOnly?: boolean; offset?: number } = {},
): Promise<{
  ok: true;
  scanned: number;
  published: number;
  rejected: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
}> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);

  const { data, error } = await supabase
    .from('product_cache')
    .select('marketplace, product_id, product_title, last_updated')
    .eq('cache_version', FULL_PRODUCT_CACHE_VERSION)
    .order('last_updated', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[seo-publish] batch-publish', error);
    throw new Error(error.message);
  }

  const reasons: Record<string, number> = {};
  let published = 0;
  let rejected = 0;
  let skipped = 0;
  let failed = 0;
  const rows = data ?? [];

  for (const row of rows) {
    const mp = String(row.marketplace ?? '');
    const pid = String(row.product_id ?? '');
    if (!VALID_MPS.has(mp) || !pid) {
      skipped += 1;
      continue;
    }
    try {
      const result = await runSeoPublish(supabase, mp as Marketplace, pid, {
        featuredOnly: Boolean(opts.featuredOnly),
      });
      if (result.published) published += 1;
      else if (result.skipped === 'rejected') {
        rejected += 1;
        const r = result.rejectReason ?? 'rejected';
        reasons[r] = (reasons[r] ?? 0) + 1;
      } else if (result.skipped) {
        skipped += 1;
        reasons[result.skipped] = (reasons[result.skipped] ?? 0) + 1;
      } else if (!result.ok) {
        failed += 1;
        reasons[result.rejectReason ?? 'failed'] =
          (reasons[result.rejectReason ?? 'failed'] ?? 0) + 1;
      } else {
        skipped += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn('[seo-publish] batch item', mp, pid, e);
    }
  }

  return {
    ok: true,
    scanned: rows.length,
    published,
    rejected,
    skipped,
    failed,
    reasons,
  };
}

export async function collectSeoPublishMetrics(supabase: SupabaseClient): Promise<{
  ok: true;
  published: number;
  rejected: number;
  draft: number;
  archived: number;
  rejectReasons: Record<string, number>;
  withCategory: number;
  withoutCategory: number;
  avgQuality: number | null;
}> {
  const { data: statusRows, error } = await supabase
    .from('seo_product_pages')
    .select('publish_status, reject_reason, category_slug, quality_score');

  if (error) throw new Error(error.message);

  let published = 0;
  let rejected = 0;
  let draft = 0;
  let archived = 0;
  let withCategory = 0;
  let withoutCategory = 0;
  let qualitySum = 0;
  let qualityN = 0;
  const rejectReasons: Record<string, number> = {};

  for (const row of statusRows ?? []) {
    const st = String(row.publish_status ?? '');
    if (st === 'published') published += 1;
    else if (st === 'rejected') {
      rejected += 1;
      const rr = String(row.reject_reason ?? 'unknown');
      rejectReasons[rr] = (rejectReasons[rr] ?? 0) + 1;
    } else if (st === 'draft') draft += 1;
    else if (st === 'archived') archived += 1;

    if (row.category_slug) withCategory += 1;
    else withoutCategory += 1;

    const q = Number(row.quality_score);
    if (Number.isFinite(q)) {
      qualitySum += q;
      qualityN += 1;
    }
  }

  return {
    ok: true,
    published,
    rejected,
    draft,
    archived,
    rejectReasons,
    withCategory,
    withoutCategory,
    avgQuality: qualityN ? Math.round((qualitySum / qualityN) * 10) / 10 : null,
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
