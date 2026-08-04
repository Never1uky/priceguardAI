// Server-side reviews fetch (WB / Ozon / YM).
// POST { marketplace, productId, productUrl?, limit? }
// Temporarily gated: x-cron-secret / service_role only (+ rate limit).
// Extension has no caller — reopen for JWT later via ALLOW_REVIEWS_FETCH_JWT=1.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import { authorizeCronOrServiceRole } from '../_shared/cron-auth.ts';
import { isEdgeRateLimited, logEdgeRequest } from '../_shared/edge-rate-limit.ts';
import { stripProductIdPrefix } from '../_shared/product-id.ts';
import { fetchWildberriesReviewsServer } from '../_shared/wb-reviews.ts';
import { fetchOzonReviewsServer } from '../_shared/ozon-reviews.ts';
import { fetchYandexMarketReviewsServer } from '../_shared/ym-reviews.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { reconstructUrl } from '../_shared/marketplace-prices.ts';
import type { Marketplace } from '../_shared/product-url.ts';

const VALID: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];
const ENDPOINT = 'reviews-fetch';
const RATE_MAX = Number(Deno.env.get('REVIEWS_FETCH_RATE_LIMIT_MAX') ?? '20');
const RATE_WINDOW_MIN = Number(Deno.env.get('REVIEWS_FETCH_RATE_LIMIT_WINDOW_MIN') ?? '60');

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
    const allowJwt = Deno.env.get('ALLOW_REVIEWS_FETCH_JWT')?.trim() === '1';
    const isInternal = authorizeCronOrServiceRole(req);
    let userId: string | null = null;

    if (!isInternal) {
      if (!allowJwt) {
        return jsonResponse({
          ok: false,
          error: 'reviews-fetch is internal-only (cron/service). Set ALLOW_REVIEWS_FETCH_JWT=1 to reopen.',
          code: 'INTERNAL_ONLY',
        }, 403);
      }
      const user = await requireAuthUser(req, true);
      userId = user!.id;
    }

    const supabase = serviceClient();
    const rateKey = userId ?? 'service';
    if (
      await isEdgeRateLimited(supabase, {
        endpoint: ENDPOINT,
        userId: userId ?? null,
        deviceId: userId ? null : rateKey,
        max: RATE_MAX,
        windowMin: RATE_WINDOW_MIN,
      })
    ) {
      return jsonResponse({
        ok: false,
        code: 'rate_limit',
        error: 'Превышен лимит reviews-fetch. Попробуйте позже.',
      }, 429);
    }

    const body = await req.json();
    const marketplace = String(body.marketplace ?? '') as Marketplace;
    const productId = stripProductIdPrefix(
      marketplace || 'wildberries',
      String(body.productId ?? ''),
    );
    const limit = Math.min(80, Math.max(5, Number(body.limit ?? 30) || 30));
    const productUrl = String(body.productUrl ?? '').trim() ||
      (productId && VALID.includes(marketplace)
        ? reconstructUrl(marketplace, productId)
        : '');

    if (!VALID.includes(marketplace)) {
      return jsonResponse({ ok: false, error: 'Invalid marketplace' }, 400);
    }
    if (!productId) {
      return jsonResponse({ ok: false, error: 'productId required' }, 400);
    }

    await logEdgeRequest(supabase, {
      endpoint: ENDPOINT,
      userId,
      deviceId: userId ? null : rateKey,
    });

    const scraper = projectScraperCredentials();
    let result;

    if (marketplace === 'wildberries') {
      result = await fetchWildberriesReviewsServer(productId, limit);
    } else if (marketplace === 'ozon') {
      result = await fetchOzonReviewsServer(productId, productUrl, limit, scraper);
    } else {
      result = await fetchYandexMarketReviewsServer(
        productId,
        productUrl,
        limit,
        scraper,
      );
    }

    return jsonResponse({
      ok: true,
      marketplace,
      productId,
      reviews: result.reviews,
      totalFound: result.totalFound,
      items: result.items.slice(0, 5),
      usedUnlocker: Boolean(scraper) && marketplace !== 'wildberries',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('[reviews-fetch]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
