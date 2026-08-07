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
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { isEdgeRateLimited, logEdgeRequest } from '../_shared/edge-rate-limit.ts';

const LIST_SELECT =
  'slug, canonical_path, title, brand, brand_slug, category, category_slug, quality_score, review_count, price_current, currency, image_url, product_url, marketplace, product_id, published_at, updated_at, analyzed_at';

const DETAIL_SELECT =
  `${LIST_SELECT}, analysis_snapshot, offers_snapshot, rating, publish_status`;

const DEFAULT_LIST_LIMIT = 24;
const MAX_LIST_LIMIT = 50;
const RELATED_LIMIT = 6;
const RATE_MAX = 120;
const RATE_WINDOW_MIN = 1;

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
  return {
    slug: row.slug,
    canonicalPath: row.canonical_path,
    title: row.title,
    brand: row.brand,
    brandSlug: row.brand_slug,
    category: row.category,
    categorySlug: row.category_slug,
    qualityScore: row.quality_score,
    reviewCount: row.review_count,
    priceCurrent: row.price_current,
    currency: row.currency ?? 'RUB',
    imageUrl: row.image_url,
    productUrl: row.product_url,
    marketplace: row.marketplace,
    productId: row.product_id,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    analyzedAt: row.analyzed_at,
    summary,
  };
}

function detailItem(row: Record<string, unknown>) {
  return {
    ...listItem(row),
    rating: row.rating,
    analysis: row.analysis_snapshot ?? null,
    offers: Array.isArray(row.offers_snapshot) ? row.offers_snapshot : [],
  };
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

      const { data, error } = await supabase
        .from('seo_product_pages')
        .select(DETAIL_SELECT)
        .eq('slug', slug)
        .eq('publish_status', 'published')
        .maybeSingle();

      if (error) {
        console.error('[seo-pages] get', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      if (!data) return jsonResponse({ ok: false, error: 'Not found' }, 404);
      return jsonResponse({ ok: true, page: detailItem(data as Record<string, unknown>) });
    }

    if (action === 'brand') {
      const brandSlug = String(params.brandSlug ?? params.brand_slug ?? '').trim().slice(0, 120);
      if (!brandSlug) return jsonResponse({ ok: false, error: 'brandSlug required' }, 400);
      const limit = clampLimit(params.limit);

      const { data, error } = await supabase
        .from('seo_product_pages')
        .select(LIST_SELECT)
        .eq('publish_status', 'published')
        .eq('brand_slug', brandSlug)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);

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

      const { data, error } = await supabase
        .from('seo_product_pages')
        .select(LIST_SELECT)
        .eq('publish_status', 'published')
        .eq('category_slug', categorySlug)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);

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
        .select(LIST_SELECT)
        .eq('publish_status', 'published')
        .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
        .limit(limit);

      if (error) {
        console.error('[seo-pages] search', error);
        const safe = q.replace(/[%_,.()]/g, ' ').trim();
        const { data: fallback, error: fbErr } = await supabase
          .from('seo_product_pages')
          .select(LIST_SELECT)
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
        .select('slug, brand_slug, category_slug')
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

      let query = supabase
        .from('seo_product_pages')
        .select(LIST_SELECT)
        .eq('publish_status', 'published')
        .neq('slug', slug)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (brandSlug && categorySlug) {
        query = query.or(`brand_slug.eq.${brandSlug},category_slug.eq.${categorySlug}`);
      } else if (brandSlug) {
        query = query.eq('brand_slug', brandSlug);
      } else if (categorySlug) {
        query = query.eq('category_slug', categorySlug);
      } else {
        return jsonResponse({ ok: true, slug, items: [] });
      }

      const { data, error } = await query;
      if (error) {
        console.error('[seo-pages] related', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const items = (data ?? []).map((r) => listItem(r as Record<string, unknown>));
      return jsonResponse({ ok: true, slug, items });
    }

    if (action === 'latest') {
      const limit = clampLimit(params.limit, 50);
      const { data, error } = await supabase
        .from('seo_product_pages')
        .select(LIST_SELECT)
        .eq('publish_status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) {
        console.error('[seo-pages] latest', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      const items = (data ?? []).map((r) => listItem(r as Record<string, unknown>));
      return jsonResponse({ ok: true, items });
    }

    return jsonResponse({
      ok: false,
      error: 'Unknown action. Use get|brand|category|search|related|latest',
    }, 400);
  } catch (error) {
    console.error('[seo-pages]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
