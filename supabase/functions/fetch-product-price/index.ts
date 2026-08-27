/**
 * Premium: загрузка цены карточки через Scrappey (сервер).
 * POST { marketplace, url, productId?, selectedMarketplaces?, skipCache? }
 * → { ok, price, title?, url, source }
 *
 * Secrets: SCRAPPEY_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import {
  extractAliExpressProductId,
  extractMegamarketProductId,
  fetchMarketplacePriceDetailed,
  type Marketplace,
} from '../_shared/marketplace-prices.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { loadCostGuards, scraperForMarketplace } from '../_shared/cost-guards.ts';
import { resolveUserPlanAccess } from '../_shared/premium-active.ts';
import { corsHeaders, handleCors, jsonResponse } from '../_shared/utils.ts';

const VALID: Marketplace[] = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
];

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
  if (marketplace === 'megamarket') {
    return extractMegamarketProductId(url);
  }
  if (marketplace === 'aliexpress') {
    return extractAliExpressProductId(url);
  }
  return url.match(/\/product\/(\d+)/i)?.[1] ?? '';
}

async function userHasPremium(userId: string): Promise<boolean> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const plan = await resolveUserPlanAccess(supabase, userId);
  return plan.premiumTier;
}

function parseSelected(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
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

    const body = await req.json();
    const marketplace = String(body.marketplace ?? '') as Marketplace;
    const url = String(body.url ?? '').trim();
    const selected = parseSelected(body.selectedMarketplaces);

    if (!VALID.includes(marketplace)) {
      return jsonResponse(
        {
          ok: false,
          error: 'marketplace не разрешён для unlocker',
          code: 'MARKETPLACE_NOT_ALLOWED',
        },
        400,
      );
    }

    if (!url.startsWith('http')) {
      return jsonResponse(
        { ok: false, error: 'url обязателен', code: 'BAD_REQUEST' },
        400,
      );
    }

    // Defense in depth: client must declare selection; marketplace must be in it.
    // (Full trust would require synced prefs — deferred; still blocks accidental calls.)
    if (!selected.includes(marketplace)) {
      return jsonResponse(
        {
          ok: false,
          error: 'Площадка не выбрана в «Где искать»',
          code: 'MARKETPLACE_NOT_SELECTED',
        },
        403,
      );
    }

    const productId =
      String(body.productId ?? '').trim() || extractProductId(marketplace, url);
    if (!productId) {
      return jsonResponse(
        { ok: false, error: 'Не удалось определить id товара', code: 'BAD_PRODUCT_ID' },
        400,
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const guards = await loadCostGuards(supabase);
    const projectScraper = projectScraperCredentials();
    if (!projectScraper) {
      return jsonResponse(
        {
          ok: false,
          error: 'Unlocker не настроен (SCRAPPEY_API_KEY)',
          code: 'SCRAPER_NOT_CONFIGURED',
        },
        503,
      );
    }
    const scraper = scraperForMarketplace(guards, marketplace, projectScraper);
    if (!scraper) {
      return jsonResponse(
        {
          ok: false,
          error: guards.scrappeyEnabled
            ? 'Unlocker отключён для этой площадки (cost guards)'
            : 'Scrappey временно отключён (cost guards)',
          code: 'SCRAPER_DISABLED',
        },
        503,
      );
    }

    const fetched = await fetchMarketplacePriceDetailed(
      marketplace,
      productId,
      url,
      {
        scraper,
        supabase,
        skipCacheRead: Boolean(body.skipCache),
        cacheTtlMs: guards.priceCacheTtlMs,
      },
    );

    if (!fetched?.price) {
      return jsonResponse(
        { ok: false, error: 'Не удалось получить цену', code: 'PRICE_NOT_FOUND' },
        404,
      );
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
