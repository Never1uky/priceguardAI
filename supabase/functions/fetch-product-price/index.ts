/**
 * Premium: загрузка цены карточки через Scrappey (сервер).
 * POST { marketplace, url, productId? }
 * → { ok, price, title?, url, source }
 *
 * Secrets: SCRAPPEY_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import {
  fetchMarketplacePriceDetailed,
  type Marketplace,
} from '../_shared/marketplace-prices.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { isPremiumRowActive } from '../_shared/premium-active.ts';
import { corsHeaders, handleCors, jsonResponse } from '../_shared/utils.ts';

const VALID: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];

function extractProductId(marketplace: Marketplace, url: string): string {
  if (marketplace === 'wildberries') {
    return url.match(/\/catalog\/(\d+)/i)?.[1] ?? '';
  }
  if (marketplace === 'ozon') {
    return (
      url.match(/\/product\/[^/]*?-(\d{6,})(?:\/|$|\?)/i)?.[1] ??
      url.match(/\/product\/(\d{6,})(?:\/|$|\?)/i)?.[1] ??
      ''
    );
  }
  return url.match(/\/product\/(\d+)/i)?.[1] ?? '';
}

async function userHasPremium(userId: string): Promise<boolean> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data } = await supabase
    .from('user_premium')
    .select('user_id, expires_at, license_key_id, license_keys(is_active, expires_at)')
    .eq('user_id', userId)
    .maybeSingle();

  return isPremiumRowActive(data);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    let userId: string;
    try {
      const user = await requireAuthUser(req, true);
      userId = user!.id;
    } catch {
      return jsonResponse(
        { ok: false, error: 'Войдите в аккаунт', code: 'AUTH_REQUIRED' },
        401,
      );
    }

    if (!(await userHasPremium(userId))) {
      return jsonResponse(
        { ok: false, error: 'Доступно в Premium', code: 'PREMIUM_REQUIRED' },
        403,
      );
    }

    const scraper = projectScraperCredentials();
    if (!scraper) {
      return jsonResponse(
        {
          ok: false,
          error: 'Unlocker не настроен (SCRAPPEY_API_KEY)',
          code: 'SCRAPER_NOT_CONFIGURED',
        },
        503,
      );
    }

    const body = await req.json();
    const marketplace = String(body.marketplace ?? '') as Marketplace;
    const url = String(body.url ?? '').trim();

    if (!VALID.includes(marketplace) || !url.startsWith('http')) {
      return jsonResponse({ ok: false, error: 'marketplace и url обязательны' }, 400);
    }

    const productId =
      String(body.productId ?? '').trim() || extractProductId(marketplace, url);
    if (!productId) {
      return jsonResponse({ ok: false, error: 'Не удалось определить id товара' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const fetched = await fetchMarketplacePriceDetailed(
      marketplace,
      productId,
      url,
      { scraper, supabase, skipCacheRead: Boolean(body.skipCache) },
    );

    if (!fetched?.price) {
      return jsonResponse({ ok: false, error: 'Не удалось получить цену' }, 404);
    }

    return jsonResponse({
      ok: true,
      price: fetched.price,
      title: fetched.title ?? null,
      url: fetched.url,
      source: fetched.source,
    });
  } catch (error) {
    console.error('[fetch-product-price]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
