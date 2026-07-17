/**
 * Поиск товара через фоновую вкладку: открывает выдачу, парсит карточки, выбирает лучший match.
 */
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import { buildSearchNotFoundOffer } from '@/utils/parsers/search-results';
import { userFacingError } from '@/lib/fetch-retry';
import { acquireHiddenBrowser, releaseHiddenBrowser } from '@/lib/hidden-browser';
import { searchOzonInTab } from '@/lib/ozon-tab-search';
import { isOfferWithPrice } from '@/lib/compare-offers';
import { isProductPageUrl, isUrlExcluded } from '@/lib/product-match';
import { getSerpCachedOffer, setSerpCachedOffer } from '@/lib/serp-cache';

const TAB_LOAD_TIMEOUT_MS = 35_000;
const SCRAPE_DELAYS: Record<ComparisonMarketplace, number> = {
  wildberries: 3_500,
  ozon: 5_000,
  yandex_market: 4_500,
};

const SEARCH_RETRY_DELAYS: Record<ComparisonMarketplace, number[]> = {
  wildberries: [0, 1_000, 2_500, 4_000],
  ozon: [0, 1_500, 3_500, 5_500],
  yandex_market: [0, 1_000, 2_500, 4_000],
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Страница поиска не загрузилась'));
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

async function scrollSearchPage(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.scrollTo(0, 600);
        window.scrollTo(0, 1200);
        window.scrollTo(0, 0);
      },
    });
  } catch {
    // страница может не позволить скролл
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.ok) return;
  } catch {
    // content script ещё не подключён
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files?.length) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [...files],
    });
    await delay(1_000);
  } catch {
    // страница может блокировать инъекцию
  }
}

async function sendSearchMessage(
  tabId: number,
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
): Promise<MarketplaceOffer | null> {
  const delays = SEARCH_RETRY_DELAYS[marketplace];

  for (const wait of delays) {
    if (wait) await delay(wait);

    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'SCRAPE_MARKETPLACE_SEARCH',
        marketplace,
        query,
        referenceTitle,
        referencePrice,
        referenceSpecs,
        excludedUrls,
      });

      if (response?.ok && response.offer) {
        const offer = response.offer as MarketplaceOffer;
        if (offer.needsManualPick && offer.searchCandidates?.length) {
          return offer;
        }
        if (offer.found && offer.price && offer.url && isProductPageUrl(offer.url)) {
          return offer;
        }
      }
    } catch {
      // content script ещё не готов — повтор
    }
  }

  return null;
}

export async function searchViaBrowserTab(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
): Promise<MarketplaceOffer> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const searchUrl = buildMarketplaceSearchUrl(marketplace, query);

  const cached = await getSerpCachedOffer(marketplace, query, ref);
  if (cached) {
    if (cached.url && excludedUrls?.length && isUrlExcluded(cached.url, excludedUrls)) {
      // stale cache hit на rejected URL — игнорируем
    } else if (
      cached.needsManualPick ||
      (cached.found && cached.price && cached.price > 0)
    ) {
      return cached;
    }
  }

  try {
    const browser = acquireHiddenBrowser();
    const tabId = await browser.navigate(searchUrl);

    await waitForTabComplete(tabId);
    await delay(SCRAPE_DELAYS[marketplace]);
    await scrollSearchPage(tabId);
    await delay(800);
    await ensureContentScript(tabId);

    if (marketplace === 'ozon') {
      const fromPageApi = await searchOzonInTab(tabId, query, ref, referencePrice, excludedUrls);
      if (
        fromPageApi &&
        (fromPageApi.needsManualPick ||
          (isOfferWithPrice(fromPageApi) &&
            fromPageApi.url &&
            isProductPageUrl(fromPageApi.url)))
      ) {
        await setSerpCachedOffer(marketplace, query, ref, fromPageApi);
        return fromPageApi;
      }
    }

    const offer = await sendSearchMessage(
      tabId,
      marketplace,
      query,
      ref,
      referencePrice,
      referenceSpecs,
      excludedUrls,
    );
    if (offer) {
      // setSerpCachedOffer сам пропустит notFound
      await setSerpCachedOffer(marketplace, query, ref, offer);
      return offer;
    }

    return buildSearchNotFoundOffer(
      marketplace,
      query,
      `В выдаче не найден подходящий товар (запрос: «${query}»). Укажите ссылку вручную.`,
    );
  } catch (error) {
    return buildSearchNotFoundOffer(marketplace, query, userFacingError(error));
  } finally {
    void releaseHiddenBrowser();
  }
}
