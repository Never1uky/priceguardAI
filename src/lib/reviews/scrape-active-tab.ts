/**
 * Сбор отзывов с уже открытой вкладки пользователя (быстрее и стабильнее hidden tab).
 */

import { findTabForProduct } from '@/lib/reviews/tab-resolver';
import { ensureContentScript } from '@/lib/active-product-tab';
import type { Marketplace } from '@/types/product';
import type { ReviewFilter } from '@/types/review-analysis';
import { detectMarketplace } from '@/utils/marketplace';

export interface ActiveTabReviewsResult {
  reviews: string[];
  totalFound: number;
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return Boolean(pong?.ok);
  } catch {
    return false;
  }
}

/**
 * Пытается собрать отзывы с открытой вкладки карточки товара.
 * Не переключает активную вкладку и не меняет URL.
 */
export async function scrapeReviewsFromActiveTab(
  productUrl: string,
  filter: ReviewFilter = 'all',
  allowNavigation = false,
): Promise<ActiveTabReviewsResult | null> {
  if (!productUrl) return null;

  const tab = await findTabForProduct(productUrl);
  if (!tab?.id) return null;

  let alive = await pingContentScript(tab.id);
  if (!alive) {
    alive = await ensureContentScript(tab.id);
  }
  if (!alive) return null;

  const retryDelays = [0, 1_500, 3_000, 5_000];
  for (const wait of retryDelays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const response = (await chrome.tabs.sendMessage(tab.id, {
        type: 'SCRAPE_REVIEWS',
        filter,
        allowNavigation,
      })) as { ok?: boolean; reviews?: string[]; totalFound?: number } | undefined;

      const reviews = response?.reviews ?? [];
      if (response?.ok && reviews.length > 0) {
        return { reviews, totalFound: response.totalFound ?? reviews.length };
      }
    } catch {
      // content script ещё не готов
    }
  }

  return null;
}

/** Отзывы с активной вкладки браузера (если это карточка маркетплейса). */
export async function scrapeReviewsFromCurrentActiveTab(
  filter: ReviewFilter = 'all',
  allowNavigation = false,
): Promise<(ActiveTabReviewsResult & { marketplace: Marketplace; url: string }) | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || !active.url) return null;

  let alive = await pingContentScript(active.id);
  if (!alive) {
    alive = await ensureContentScript(active.id);
  }
  if (!alive) return null;

  try {
    const response = (await chrome.tabs.sendMessage(active.id, {
      type: 'SCRAPE_REVIEWS',
      filter,
      allowNavigation,
    })) as { ok?: boolean; reviews?: string[]; totalFound?: number } | undefined;

    const reviews = response?.reviews ?? [];
    if (!response?.ok || reviews.length === 0) return null;

    const mp = detectMarketplace(active.url);
    if (!mp) return null;

    return {
      reviews,
      totalFound: response.totalFound ?? reviews.length,
      marketplace: mp,
      url: active.url,
    };
  } catch {
    return null;
  }
}
