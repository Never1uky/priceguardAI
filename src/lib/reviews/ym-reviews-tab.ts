/**
 * Сбор отзывов Я.Маркет через фоновую вкладку (когда активная вкладка недоступна).
 */
import { acquireHiddenBrowser, releaseHiddenBrowser } from '@/lib/hidden-browser';
import { ensureContentScriptReady } from '@/lib/safe-messaging';
import type { ReviewFilter } from '@/types/review-analysis';
import { toCanonicalProductUrl } from '@/utils/product-url';

const TAB_LOAD_TIMEOUT_MS = 40_000;
const PAGE_DELAY_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Страница Я.Маркет не загрузилась'));
    }, TAB_LOAD_TIMEOUT_MS);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  await ensureContentScriptReady(tabId);
}

export async function scrapeYandexReviewsViaHiddenTab(
  productUrl: string,
  filter: ReviewFilter = 'all',
): Promise<{ reviews: string[]; totalFound: number }> {
  const canonical = toCanonicalProductUrl(productUrl, 'yandex_market');
  const browser = acquireHiddenBrowser();

  try {
    return await browser.runExclusive(async (nav) => {
      const tabId = await nav(canonical);

      await waitForTabComplete(tabId);
      await delay(PAGE_DELAY_MS);
      await ensureContentScript(tabId);

      const delays = [0, 1_500, 3_000, 5_000];

      for (const wait of delays) {
        if (wait) await delay(wait);

        try {
          const response = (await chrome.tabs.sendMessage(tabId, {
            type: 'SCRAPE_REVIEWS',
            filter,
          })) as { ok?: boolean; reviews?: string[]; totalFound?: number } | undefined;

          const reviews = response?.reviews ?? [];
          if (response?.ok && reviews.length > 0) {
            return { reviews, totalFound: response.totalFound ?? reviews.length };
          }
        } catch {
          // retry
        }
      }

      return { reviews: [], totalFound: 0 };
    });
  } catch (error) {
    console.warn('[PriceGuard] scrapeYandexReviewsViaHiddenTab:', error);
    return { reviews: [], totalFound: 0 };
  } finally {
    void releaseHiddenBrowser(browser);
  }
}
