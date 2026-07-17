// PriceGuard AI — общий кэш отзывов и AI-анализа (product_cache).
//
// Действия:
//   { action: 'get', marketplace, productId, cacheVersion? }
//     → { ok, entry | null }
//   { action: 'put', marketplace, productId, productTitle?, model?,
//       rawReviews?, aiAnalysis?, cacheVersion? }
//     → { ok }
//
// Доступ только через service_role — клиент (anon) не пишет напрямую.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

const VALID_MARKETPLACES = ['wildberries', 'ozon', 'yandex_market'];

/** TTL кэша — 7 дней (серверная проверка, дублирует клиент). */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isCacheFresh(lastUpdated: string | null | undefined): boolean {
  if (!lastUpdated) return false;
  const ts = Date.parse(lastUpdated);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const marketplace = String(body.marketplace ?? '');
    const productId = String(body.productId ?? '').slice(0, 64);
    const cacheVersion = Number(body.cacheVersion ?? 1) || 1;

    if (!VALID_MARKETPLACES.includes(marketplace)) {
      return jsonResponse({ ok: false, error: 'Invalid marketplace' }, 400);
    }
    if (!productId) {
      return jsonResponse({ ok: false, error: 'productId required' }, 400);
    }

    const supabase = serviceClient();

    if (action === 'get') {
      const { data, error } = await supabase
        .from('product_cache')
        .select('marketplace, product_id, product_title, model, raw_reviews, ai_analysis, last_updated, cache_version')
        .eq('marketplace', marketplace)
        .eq('product_id', productId)
        .eq('cache_version', cacheVersion)
        .maybeSingle();

      if (error) {
        console.error('product_cache get', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }
      if (data && !isCacheFresh(data.last_updated)) {
        return jsonResponse({ ok: true, entry: null, expired: true });
      }
      return jsonResponse({ ok: true, entry: data ?? null });
    }

    if (action === 'put') {
      const row = {
        marketplace,
        product_id: productId,
        product_title: body.productTitle ? String(body.productTitle).slice(0, 500) : null,
        model: body.model ? String(body.model).slice(0, 64) : null,
        raw_reviews: body.rawReviews ?? null,
        ai_analysis: body.aiAnalysis ?? null,
        last_updated: new Date().toISOString(),
        cache_version: cacheVersion,
      };

      const { error } = await supabase
        .from('product_cache')
        .upsert(row, { onConflict: 'marketplace,product_id,cache_version' });

      if (error) {
        console.error('product_cache put', error);
        return jsonResponse({ ok: false, error: 'Write failed' }, 500);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('product-cache error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
