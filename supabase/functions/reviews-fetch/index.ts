// Server-side reviews fetch (WB / Ozon / YM).
// POST { marketplace, productId, productUrl?, limit? }

import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { stripProductIdPrefix } from '../_shared/product-id.ts';
import { fetchWildberriesReviewsServer } from '../_shared/wb-reviews.ts';
import { fetchOzonReviewsServer } from '../_shared/ozon-reviews.ts';
import { fetchYandexMarketReviewsServer } from '../_shared/ym-reviews.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { reconstructUrl } from '../_shared/marketplace-prices.ts';
import type { Marketplace } from '../_shared/product-url.ts';

const VALID: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
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
    console.error('[reviews-fetch]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
