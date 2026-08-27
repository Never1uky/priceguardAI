/**
 * Premium: цена карточки через Edge Unlocker (Scrappey), когда API + вкладка не дали цену.
 * Defense in depth: Premium + core MP + selected in «Где искать».
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { isPremium } from '@/lib/subscription';
import { getSelectedSearchMarketplaces } from '@/lib/marketplaces/search-settings';
import { trackCompareMpAttempt } from '@/lib/telemetry/compare-mp-attempt';
import { trackScrapeCacheHit, trackScrapeRequest } from '@/lib/telemetry/ops';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { extractComparisonArticle } from '@/utils/comparison-url';

/** Only these MPs may hit Scrappey (never test MPs / DNS / …). Mega + Ali = card unlocker only. */
export const PREMIUM_UNLOCKER_MARKETPLACES = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
] as const satisfies readonly ComparisonMarketplace[];

export type PremiumUnlockerDenyReason = 'not_core' | 'not_premium' | 'not_selected';

export function isPremiumUnlockerMarketplace(
  marketplace: ComparisonMarketplace,
): marketplace is (typeof PREMIUM_UNLOCKER_MARKETPLACES)[number] {
  return (PREMIUM_UNLOCKER_MARKETPLACES as readonly string[]).includes(marketplace);
}

/**
 * Assert Scrappey eligibility before any Edge call.
 * Callers must also pass skipUnlocker for TG backup / SERP-priced picks.
 */
export async function assertPremiumUnlockerAllowed(
  marketplace: ComparisonMarketplace,
): Promise<{ ok: true } | { ok: false; reason: PremiumUnlockerDenyReason }> {
  if (!isPremiumUnlockerMarketplace(marketplace)) {
    return { ok: false, reason: 'not_core' };
  }
  try {
    if (!(await isPremium())) return { ok: false, reason: 'not_premium' };
  } catch {
    return { ok: false, reason: 'not_premium' };
  }
  try {
    const selected = await getSelectedSearchMarketplaces();
    if (!selected.includes(marketplace)) {
      return { ok: false, reason: 'not_selected' };
    }
  } catch {
    return { ok: false, reason: 'not_selected' };
  }
  return { ok: true };
}

export async function fetchOfferViaPremiumUnlocker(
  url: string,
  marketplace: ComparisonMarketplace,
): Promise<MarketplaceOffer | null> {
  const gate = await assertPremiumUnlockerAllowed(marketplace);
  if (!gate.ok) {
    trackCompareMpAttempt({
      marketplace,
      path: 'skip',
      success: false,
      reason: `unlocker_${gate.reason}`,
    });
    return null;
  }

  const productId = extractComparisonArticle(url, marketplace) || undefined;

  const selected = await getSelectedSearchMarketplaces();
  const res = await callEdgeSafe<{
    ok?: boolean;
    price?: number;
    title?: string | null;
    url?: string;
    source?: string;
    error?: string;
    code?: string;
  }>('fetch-product-price', {
    marketplace,
    url,
    productId,
    // Prefer shared price_scrape_cache before Scrappey (TTL-gated server-side).
    // Mega + Ali after MEGA-4 / ALI-4 CHECK widen.
    skipCache: false,
    selectedMarketplaces: selected,
  });

  const ok = Boolean(res?.ok && res.price && res.price > 0);
  trackCompareMpAttempt({
    marketplace,
    path: 'scrappey',
    success: ok,
    reason: ok ? undefined : res?.error?.slice(0, 80) ?? 'no_price',
  });
  if (res?.source === 'cache') {
    trackScrapeCacheHit({ marketplace, context: 'unlocker', source: 'cache' });
  } else {
    trackScrapeRequest({
      marketplace,
      context: 'unlocker',
      source: 'scrappey',
      success: ok,
      reason: ok ? undefined : res?.error?.slice(0, 64) ?? 'no_price',
    });
  }

  if (!ok) return null;

  return {
    marketplace,
    title: res!.title?.trim() || 'Товар',
    price: res!.price!,
    delivery: null,
    rating: null,
    url: res!.url || url,
    found: true,
  };
}
