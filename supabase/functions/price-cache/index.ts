/**
 * Shared price_scrape_cache get/put for authenticated users (any plan).
 * Saves Scrappey when another user (or cron) already scraped the SKU within TTL.
 *
 * { action: 'get', marketplace, productId }
 * { action: 'put', marketplace, productId, price, title?, url }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import {
  getCachedPrice,
  setCachedPrice,
  type CacheMarketplace,
} from '../_shared/price-scrape-cache.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

const VALID: CacheMarketplace[] = ['wildberries', 'ozon', 'yandex_market'];

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
    await requireAuthUser(req, true);
    const body = await req.json();
    const action = String(body.action ?? '');
    const marketplace = String(body.marketplace ?? '') as CacheMarketplace;
    const productId = String(body.productId ?? '').trim();

    if (!VALID.includes(marketplace) || !productId) {
      return jsonResponse({ ok: false, error: 'marketplace и productId обязательны' }, 400);
    }

    const supabase = serviceClient();

    if (action === 'get') {
      const cached = await getCachedPrice(supabase, marketplace, productId);
      if (!cached) return jsonResponse({ ok: true, hit: false });
      return jsonResponse({
        ok: true,
        hit: true,
        price: cached.price,
        title: cached.title ?? null,
        url: cached.url,
        source: 'cache',
      });
    }

    if (action === 'put') {
      const price = Number(body.price);
      const url = String(body.url ?? '').trim();
      if (!price || price <= 0 || !url.startsWith('http')) {
        return jsonResponse({ ok: false, error: 'price и url обязательны' }, 400);
      }
      await setCachedPrice(
        supabase,
        marketplace,
        productId,
        {
          price,
          title: body.title ? String(body.title).slice(0, 300) : undefined,
          url,
        },
        'legacy',
      );
      return jsonResponse({ ok: true, stored: true });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('[price-cache]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
