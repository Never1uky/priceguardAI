/**
 * Public read API for published SEO product pages.
 * Never reads product_cache — only seo_product_pages (published).
 *
 * GET/POST:
 *   { action: 'get', slug }
 *   { action: 'brand', brandSlug, limit? }
 *   { action: 'category', categorySlug, limit? }
 *   { action: 'search', q, limit? }
 *   { action: 'related', slug, limit? }
 *   { action: 'latest', limit? }
 *   { action: 'hubs', minCount? }
 *   { action: 'sitemap', limit?, cursor? }
 *   { action: 'hit', slug } — view_count++ (24h cookie dedupe)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { isEdgeRateLimited, logEdgeRequest } from '../_shared/edge-rate-limit.ts';
import { sanitizeSeoProductTitle } from '../_shared/seo-gates.ts';

const LIST_SELECT =
  'slug, canonical_path, title, brand, brand_slug, category, category_slug, quality_score, review_count, price_current, currency, image_url, product_url, marketplace, product_id, published_at, updated_at, analyzed_at, analysis_snapshot, is_primary, primary_slug, canon_id';

const LIST_SELECT_FALLBACK =
  'slug, canonical_path, title, brand, brand_slug, category, category_slug, quality_score, review_count, price_current, currency, image_url, product_url, marketplace, product_id, published_at, updated_at, analyzed_at, analysis_snapshot';

const DETAIL_SELECT =
  `${LIST_SELECT}, offers_snapshot, rating, publish_status, view_count`;

const DETAIL_SELECT_FALLBACK =
  `${LIST_SELECT_FALLBACK}, offers_snapshot, rating, publish_status, view_count`;

/** Prefer canon columns; fall back if migration not applied yet. */
let useCanonColumns = true;

function listCols(): string {
  return useCanonColumns ? LIST_SELECT : LIST_SELECT_FALLBACK;
}
function detailCols(): string {
  return useCanonColumns ? DETAIL_SELECT : DETAIL_SELECT_FALLBACK;
}

function noteCanonColumnError(error: { message?: string } | null): void {
  const msg = String(error?.message || '');
  if (/canon_id|is_primary|primary_slug|column/i.test(msg)) {
    useCanonColumns = false;
  }
}

const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 50;
const RELATED_LIMIT = 6;
const RELATED_FETCH = 24;
const RATE_MAX = 120;
const RATE_WINDOW_MIN = 1;
const HUB_MIN_DEFAULT = 2;

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function clampLimit(raw: unknown, fallback = DEFAULT_LIST_LIMIT): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_LIST_LIMIT, Math.floor(n));
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  const realIp = req.headers.get('x-real-ip')?.trim();
  const ip = forwarded || cf || realIp || 'anon';
  return `seo:${ip.slice(0, 64)}`;
}

function listItem(row: Record<string, unknown>) {
  const snap = row.analysis_snapshot as Record<string, unknown> | null | undefined;
  const summary =
    typeof snap?.qualitySummary === 'string' ? snap.qualitySummary.slice(0, 220) : null;
  const rawTitle = String(row.title ?? '');
  const title = sanitizeSeoProductTitle(rawTitle) || rawTitle;

  const scoreRaw = row.quality_score;
  let qualityScore: number | null =
    scoreRaw == null || !Number.isFinite(Number(scoreRaw)) ? null : Number(scoreRaw);
  if (qualityScore != null && qualityScore > 10 && qualityScore <= 100) {
    qualityScore = Math.round((qualityScore / 10) * 10) / 10;
  }
  if (qualityScore != null && (qualityScore < 0 || qualityScore > 10)) {
    qualityScore = null;
  }

  const imgRaw = row.image_url == null ? '' : String(row.image_url).trim();
  const imageUrl = /^https?:\/\//i.test(imgRaw) ? imgRaw : null;

  const mpRaw = row.marketplace;
  const marketplace =
    mpRaw == null || String(mpRaw).trim() === '' ? null : row.marketplace;

  return {
    slug: row.slug,
    canonicalPath: row.canonical_path,
    title,
    brand: row.brand,
    brandSlug: row.brand_slug,
    category: row.category,
    categorySlug: row.category_slug,
    qualityScore,
    reviewCount: row.review_count,
    priceCurrent: row.price_current,
    currency: row.currency ?? 'RUB',
    imageUrl,
    productUrl: row.product_url,
    marketplace,
    productId: row.product_id,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    analyzedAt: row.analyzed_at,
    summary,
    isPrimary: row.is_primary !== false,
    primarySlug: row.primary_slug ? String(row.primary_slug) : null,
    canonId: row.canon_id ? String(row.canon_id) : null,
  };
}

function detailItem(row: Record<string, unknown>) {
  return {
    ...listItem(row),
    rating: row.rating,
    analysis: row.analysis_snapshot ?? null,
    offers: Array.isArray(row.offers_snapshot) ? row.offers_snapshot : [],
    viewCount: row.view_count == null ? 0 : Number(row.view_count),
  };
}

function normalizeAltQuery(name: string): string {
  return name
    .replace(/[%_,.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Best-effort link AI alternative names → published SEO slugs. */
async function resolveAlternativeSlugs(
  supabase: SupabaseClient,
  excludeSlug: string,
  alternatives: Array<{ name?: string; reason?: string; slug?: string | null }>,
): Promise<Array<{ name: string; reason: string; slug?: string | null }>> {
  const out: Array<{ name: string; reason: string; slug?: string | null }> = [];
  for (const alt of alternatives.slice(0, 5)) {
    const name = typeof alt.name === 'string' ? alt.name.trim() : '';
    const reason = typeof alt.reason === 'string' ? alt.reason.trim() : '';
    if (!name) continue;
    if (alt.slug) {
      out.push({ name, reason, slug: alt.slug });
      continue;
    }
    const q = normalizeAltQuery(name);
    if (q.length < 3) {
      out.push({ name, reason, slug: null });
      continue;
    }
    const tokens = q.split(' ').filter((t) => t.length > 2).slice(0, 3);
    const pattern = tokens.length ? `%${tokens.join('%')}%` : `%${q}%`;
    const { data } = await supabase
      .from('seo_product_pages')
      .select('slug, title')
      .eq('publish_status', 'published')
      .neq('slug', excludeSlug)
      .ilike('title', pattern)
      .limit(5);
    let slug: string | null = null;
    const needle = q.toLowerCase();
    for (const row of data ?? []) {
      const title = String(row.title ?? '').toLowerCase();
      if (title.includes(needle) || tokens.every((t) => title.includes(t.toLowerCase()))) {
        slug = String(row.slug);
        break;
      }
    }
    if (!slug && data?.[0]?.slug) slug = String(data[0].slug);
    out.push({ name, reason, slug });
  }
  return out;
}

function relatedRankScore(
  item: { brandSlug?: unknown; categorySlug?: unknown },
  brandSlug: string | null,
  categorySlug: string | null,
): number {
  const sameBrand = Boolean(brandSlug && item.brandSlug === brandSlug);
  const sameCat = Boolean(categorySlug && item.categorySlug === categorySlug);
  if (sameBrand && sameCat) return 300;
  if (sameCat) return 200;
  if (sameBrand) return 100;
  return 10;
}

function viewCookieName(slug: string): string {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return `seo_v_${safe}`;
}

function hasViewCookie(req: Request, slug: string): boolean {
  const name = viewCookieName(slug);
  const raw = req.headers.get('cookie') ?? '';
  return raw.split(';').some((p) => p.trim().startsWith(`${name}=`));
}

async function applyPublicRateLimit(supabase: SupabaseClient, req: Request): Promise<boolean> {
  const deviceId = clientKey(req);
  const limited = await isEdgeRateLimited(supabase, {
    endpoint: 'seo-pages',
    deviceId,
    max: RATE_MAX,
    windowMin: RATE_WINDOW_MIN,
  });
  if (limited) return true;
  void logEdgeRequest(supabase, { endpoint: 'seo-pages', deviceId });
  return false;
}

function parseParams(req: Request, body: Record<string, unknown>): Record<string, unknown> {
  const url = new URL(req.url);
  const fromQuery: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams.entries()) {
    fromQuery[k] = v;
  }
  return { ...fromQuery, ...body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const params = parseParams(req, body);
    const action = String(params.action ?? (params.slug && !params.q ? 'get' : '')).trim();

    const supabase = serviceClient();
    if (await applyPublicRateLimit(supabase, req)) {
      return jsonResponse({ ok: false, error: 'Rate limited' }, 429);
    }

    if (action === 'get') {
      const slug = String(params.slug ?? '').trim().slice(0, 120);
      if (!slug) return jsonResponse({ ok: false, error: 'slug required' }, 400);

      let { data, error } = await supabase
        .from('seo_product_pages')
        .select(detailCols())
        .eq('slug', slug)
        .eq('publish_status', 'published')
        .maybeSingle();

      if (error) {
        noteCanonColumnError(error);
        if (!useCanonColumns) {
          ({ data, error } = await supabase
            .from('seo_product_pages')
            .select(detailCols())
            .eq('slug', slug)
            .eq('publish_status', 'published')
            .maybeSingle());
        }
      }

      if (error) {
        console.error('[seo-pages] get', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      if (!data) return jsonResponse({ ok: false, error: 'Not found' }, 404);

      const primarySlug =
        data.is_primary === false && data.primary_slug
          ? String(data.primary_slug)
          : null;
      if (primarySlug && primarySlug !== slug) {
      const { data: primary } = await supabase
          .from('seo_product_pages')
          .select(detailCols())
          .eq('slug', primarySlug)
          .eq('publish_status', 'published')
          .maybeSingle();
        if (primary) {
          const page = detailItem(primary as Record<string, unknown>);
          return jsonResponse({
            ok: true,
            page,
            redirectSlug: primarySlug,
            aliasSlug: slug,
          });
        }
      }

      const page = detailItem(data as Record<string, unknown>) as {
        slug: string;
        analysis: Record<string, unknown> | null;
        [k: string]: unknown;
      };
      const alts = Array.isArray(page.analysis?.alternatives)
        ? (page.analysis!.alternatives as Array<{ name?: string; reason?: string }>)
        : [];
      if (alts.length && page.analysis) {
        page.analysis = {
          ...page.analysis,
          alternatives: await resolveAlternativeSlugs(supabase, String(page.slug), alts),
        };
      }
      return jsonResponse({ ok: true, page });
    }

    if (action === 'brand') {
      const brandSlug = String(params.brandSlug ?? params.brand_slug ?? '').trim().slice(0, 120);
      if (!brandSlug) return jsonResponse({ ok: false, error: 'brandSlug required' }, 400);
      const limit = clampLimit(params.limit);

      let q = supabase
        .from('seo_product_pages')
        .select(listCols())
        .eq('publish_status', 'published')
        .eq('brand_slug', brandSlug)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (useCanonColumns) q = q.eq('is_primary', true);
      let { data, error } = await q;
      if (error) {
        noteCanonColumnError(error);
        if (!useCanonColumns) {
          ({ data, error } = await supabase
            .from('seo_product_pages')
            .select(listCols())
            .eq('publish_status', 'published')
            .eq('brand_slug', brandSlug)
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(limit));
        }
      }

      if (error) {
        console.error('[seo-pages] brand', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const items = (data ?? []).map((r) => listItem(r as Record<string, unknown>));
      return jsonResponse({ ok: true, brandSlug, items });
    }

    if (action === 'category') {
      const categorySlug = String(params.categorySlug ?? params.category_slug ?? '')
        .trim()
        .slice(0, 120);
      if (!categorySlug) return jsonResponse({ ok: false, error: 'categorySlug required' }, 400);
      const limit = clampLimit(params.limit);

      let q = supabase
        .from('seo_product_pages')
        .select(listCols())
        .eq('publish_status', 'published')
        .eq('category_slug', categorySlug)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (useCanonColumns) q = q.eq('is_primary', true);
      let { data, error } = await q;
      if (error) {
        noteCanonColumnError(error);
        if (!useCanonColumns) {
          ({ data, error } = await supabase
            .from('seo_product_pages')
            .select(listCols())
            .eq('publish_status', 'published')
            .eq('category_slug', categorySlug)
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(limit));
        }
      }

      if (error) {
        console.error('[seo-pages] category', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const items = (data ?? []).map((r) => listItem(r as Record<string, unknown>));
      return jsonResponse({ ok: true, categorySlug, items });
    }

    if (action === 'search') {
      const q = String(params.q ?? params.query ?? '').trim().slice(0, 120);
      if (q.length < 2) return jsonResponse({ ok: false, error: 'q required (min 2)' }, 400);
      const limit = clampLimit(params.limit, 20);

      const { data, error } = await supabase
        .from('seo_product_pages')
        .select(listCols())
        .eq('publish_status', 'published')
        .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
        .limit(limit);

      if (error) {
        console.error('[seo-pages] search', error);
        const safe = q.replace(/[%_,.()]/g, ' ').trim();
        const { data: fallback, error: fbErr } = await supabase
          .from('seo_product_pages')
          .select(listCols())
          .eq('publish_status', 'published')
          .or(`title.ilike.%${safe}%,brand.ilike.%${safe}%`)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(limit);
        if (fbErr) {
          console.error('[seo-pages] search fallback', fbErr);
          return jsonResponse({ ok: false, error: 'Search failed' }, 500);
        }
        const items = (fallback ?? []).map((r) => listItem(r as Record<string, unknown>));
        return jsonResponse({ ok: true, q, items, fallback: true });
      }

      const items = (data ?? []).map((r) => listItem(r as Record<string, unknown>));
      return jsonResponse({ ok: true, q, items });
    }

    if (action === 'related') {
      const slug = String(params.slug ?? '').trim().slice(0, 120);
      if (!slug) return jsonResponse({ ok: false, error: 'slug required' }, 400);
      const limit = Math.min(RELATED_LIMIT, clampLimit(params.limit, RELATED_LIMIT));

      const { data: page, error: pageErr } = await supabase
        .from('seo_product_pages')
        .select('slug, brand_slug, category_slug, marketplace, product_id')
        .eq('slug', slug)
        .eq('publish_status', 'published')
        .maybeSingle();

      if (pageErr) {
        console.error('[seo-pages] related lookup', pageErr);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      if (!page) return jsonResponse({ ok: false, error: 'Not found' }, 404);

      const brandSlug = page.brand_slug ? String(page.brand_slug) : null;
      const categorySlug = page.category_slug ? String(page.category_slug) : null;
      const bySlug = new Map<string, ReturnType<typeof listItem>>();

      if (brandSlug || categorySlug) {
        let query = supabase
          .from('seo_product_pages')
          .select(listCols())
          .eq('publish_status', 'published')
          .neq('slug', slug)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(RELATED_FETCH);

        if (useCanonColumns) {
          query = query.eq('is_primary', true);
        }

        if (brandSlug && categorySlug) {
          query = query.or(`brand_slug.eq.${brandSlug},category_slug.eq.${categorySlug}`);
        } else if (brandSlug) {
          query = query.eq('brand_slug', brandSlug);
        } else if (categorySlug) {
          query = query.eq('category_slug', categorySlug);
        }

        const { data, error } = await query;
        if (error) {
          console.error('[seo-pages] related', error);
          return jsonResponse({ ok: false, error: 'Read failed' }, 500);
        }
        for (const r of data ?? []) {
          const item = listItem(r as Record<string, unknown>);
          bySlug.set(String(item.slug), item);
        }
      }

      // Optional: published SEO peers from cross_market_mapping targets
      const marketplace = page.marketplace ? String(page.marketplace) : '';
      const productId = page.product_id ? String(page.product_id) : '';
      if (marketplace && productId && bySlug.size < RELATED_FETCH) {
        const { data: maps } = await supabase
          .from('cross_market_mapping')
          .select('target_marketplace, target_product_id')
          .eq('source_marketplace', marketplace)
          .eq('source_product_id', productId)
          .eq('status', 'active')
          .limit(6);
        for (const m of maps ?? []) {
          const tmp = m.target_marketplace ? String(m.target_marketplace) : '';
          const tid = m.target_product_id ? String(m.target_product_id) : '';
          if (!tmp || !tid) continue;
          const key = `${tmp}:${tid.replace(/^(wildberries|ozon|yandex_market):/i, '')}`;
          let peerQuery = supabase
            .from('seo_product_pages')
            .select(listCols())
            .eq('publish_status', 'published')
            .eq('product_key', key)
            .neq('slug', slug);
          if (useCanonColumns) peerQuery = peerQuery.eq('is_primary', true);
          const { data: peer } = await peerQuery.maybeSingle();
          if (peer) {
            const item = listItem(peer as Record<string, unknown>);
            bySlug.set(String(item.slug), item);
          }
        }
      }

      const items = [...bySlug.values()]
        .sort(
          (a, b) =>
            relatedRankScore(b, brandSlug, categorySlug) -
            relatedRankScore(a, brandSlug, categorySlug),
        )
        .slice(0, limit);

      return jsonResponse({ ok: true, slug, items });
    }

    if (action === 'latest') {
      const limit = clampLimit(params.limit, 50);
      let q = supabase
        .from('seo_product_pages')
        .select(listCols())
        .eq('publish_status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (useCanonColumns) q = q.eq('is_primary', true);
      let { data, error } = await q;
      if (error) {
        noteCanonColumnError(error);
        if (!useCanonColumns) {
          ({ data, error } = await supabase
            .from('seo_product_pages')
            .select(listCols())
            .eq('publish_status', 'published')
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(limit));
        }
      }

      if (error) {
        console.error('[seo-pages] latest', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const items = (data ?? []).map((r) => listItem(r as Record<string, unknown>));
      return jsonResponse({ ok: true, items });
    }

    if (action === 'hubs') {
      const minCount = Math.max(1, Math.floor(Number(params.minCount ?? HUB_MIN_DEFAULT)) || HUB_MIN_DEFAULT);
      const { data, error } = await supabase
        .from('seo_product_pages')
        .select('brand, brand_slug, category, category_slug')
        .eq('publish_status', 'published')
        .limit(5000);
      if (error) {
        console.error('[seo-pages] hubs', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const brandMap = new Map<string, { name: string; count: number }>();
      const catMap = new Map<string, { name: string; count: number }>();
      for (const r of data ?? []) {
        const bs = r.brand_slug ? String(r.brand_slug) : '';
        const cs = r.category_slug ? String(r.category_slug) : '';
        if (bs) {
          const cur = brandMap.get(bs) ?? { name: String(r.brand || bs), count: 0 };
          cur.count += 1;
          if (r.brand) cur.name = String(r.brand);
          brandMap.set(bs, cur);
        }
        if (cs) {
          const cur = catMap.get(cs) ?? { name: String(r.category || cs), count: 0 };
          cur.count += 1;
          if (r.category) cur.name = String(r.category);
          catMap.set(cs, cur);
        }
      }
      const brands = [...brandMap.entries()]
        .filter(([, v]) => v.count >= minCount)
        .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count);
      const categories = [...catMap.entries()]
        .filter(([, v]) => v.count >= minCount)
        .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count);
      return jsonResponse({ ok: true, brands, categories, minCount });
    }

    if (action === 'sitemap') {
      const limit = Math.min(500, clampLimit(params.limit, 200));
      const cursor = params.cursor ? String(params.cursor) : null;
      let query = supabase
        .from('seo_product_pages')
        .select('slug, canonical_path, updated_at, published_at, brand_slug, category_slug')
        .eq('publish_status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('slug', { ascending: true })
        .limit(limit);
      if (useCanonColumns) {
        query = supabase
          .from('seo_product_pages')
          .select('slug, canonical_path, updated_at, published_at, brand_slug, category_slug')
          .eq('publish_status', 'published')
          .eq('is_primary', true)
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('slug', { ascending: true })
          .limit(limit);
      }
      if (cursor) {
        query = query.lt('published_at', cursor);
      }
      let { data, error } = await query;
      if (error) {
        noteCanonColumnError(error);
        if (!useCanonColumns) {
          let q2 = supabase
            .from('seo_product_pages')
            .select('slug, canonical_path, updated_at, published_at, brand_slug, category_slug')
            .eq('publish_status', 'published')
            .order('published_at', { ascending: false, nullsFirst: false })
            .order('slug', { ascending: true })
            .limit(limit);
          if (cursor) q2 = q2.lt('published_at', cursor);
          ({ data, error } = await q2);
        }
      }
      if (error) {
        console.error('[seo-pages] sitemap', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const items = (data ?? []).map((r) => ({
        slug: String(r.slug),
        canonicalPath: String(r.canonical_path ?? `/a/${r.slug}`),
        updatedAt: r.updated_at ? String(r.updated_at) : null,
        publishedAt: r.published_at ? String(r.published_at) : null,
        brandSlug: r.brand_slug ? String(r.brand_slug) : null,
        categorySlug: r.category_slug ? String(r.category_slug) : null,
      }));
      const nextCursor =
        items.length === limit && items[items.length - 1]?.publishedAt
          ? items[items.length - 1].publishedAt
          : null;
      return jsonResponse({ ok: true, items, nextCursor });
    }

    if (action === 'hit') {
      const slug = String(params.slug ?? '').trim().slice(0, 120);
      if (!slug) return jsonResponse({ ok: false, error: 'slug required' }, 400);
      if (hasViewCookie(req, slug)) {
        return jsonResponse({ ok: true, skipped: true });
      }

      const { data: row, error: readErr } = await supabase
        .from('seo_product_pages')
        .select('view_count')
        .eq('slug', slug)
        .eq('publish_status', 'published')
        .maybeSingle();
      if (readErr) {
        console.error('[seo-pages] hit read', readErr);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      if (!row) return jsonResponse({ ok: false, error: 'Not found' }, 404);

      const next = Number(row.view_count ?? 0) + 1;
      const { error: upErr } = await supabase
        .from('seo_product_pages')
        .update({
          view_count: next,
          view_count_updated_at: new Date().toISOString(),
        })
        .eq('slug', slug)
        .eq('publish_status', 'published');
      if (upErr) {
        console.error('[seo-pages] hit update', upErr);
        return jsonResponse({ ok: false, error: 'Update failed' }, 500);
      }

      const headers = new Headers(corsHeaders);
      headers.set('Content-Type', 'application/json');
      headers.append(
        'Set-Cookie',
        `${viewCookieName(slug)}=1; Max-Age=86400; Path=/; SameSite=Lax`,
      );
      return new Response(JSON.stringify({ ok: true, viewCount: next }), {
        status: 200,
        headers,
      });
    }

    return jsonResponse({
      ok: false,
      error: 'Unknown action. Use get|brand|category|search|related|latest|hubs|sitemap|hit',
    }, 400);
  } catch (error) {
    console.error('[seo-pages]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
