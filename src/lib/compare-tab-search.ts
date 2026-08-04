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
import { getSerpCachedOffer } from '@/lib/serp-cache';
import { noteEmptyScrape, resetEmptyScrape } from '@/lib/empty-scrape-guard';
import {
  OZON_ANTIBOT_USER_MESSAGE,
  scrapeOzonSerpDomInTab,
} from '@/lib/ozon-serp-dom';
import { ensureContentScriptReady } from '@/lib/safe-messaging';
import { hashQuery, telemetry } from '@/lib/telemetry';

const TAB_LOAD_TIMEOUT_MS = 35_000;
/** Poll after load until cards appear (instead of long fixed delays). */
const SERP_POLL_INTERVAL_MS = 500;
const SERP_POLL_MAX_MS: Record<ComparisonMarketplace, number> = {
  wildberries: 6_000,
  ozon: 7_000,
  yandex_market: 6_500,
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
  await ensureContentScriptReady(tabId);
}

function isUsableSearchOffer(offer: MarketplaceOffer): boolean {
  if (offer.needsManualPick && offer.searchCandidates?.length) return true;
  return Boolean(
    offer.found && offer.price && offer.url && isProductPageUrl(offer.url),
  );
}

async function tryScrapeOnce(
  tabId: number,
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
): Promise<MarketplaceOffer | null> {
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

    if (response?.ok && response.offer && isUsableSearchOffer(response.offer)) {
      return response.offer as MarketplaceOffer;
    }
  } catch {
    // content script ещё не готов
  }
  return null;
}

/** Poll scrape until cards appear or timeout. */
async function pollSearchMessage(
  tabId: number,
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
): Promise<MarketplaceOffer | null> {
  const maxMs = SERP_POLL_MAX_MS[marketplace];
  const started = Date.now();
  let attempt = 0;

  while (Date.now() - started < maxMs) {
    if (attempt > 0) await delay(SERP_POLL_INTERVAL_MS);
    attempt += 1;

    if (attempt === 2 || attempt === 5) {
      await scrollSearchPage(tabId);
    }

    const offer = await tryScrapeOnce(
      tabId,
      marketplace,
      query,
      referenceTitle,
      referencePrice,
      referenceSpecs,
      excludedUrls,
    );
    if (offer) return offer;
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
      // Only post-cascade verified product cards — never raw SERP
      cached.found &&
      cached.price &&
      cached.price > 0 &&
      cached.url &&
      isProductPageUrl(cached.url) &&
      cached.matchStatus === 'verified'
    ) {
      return cached;
    }
  }

  try {
    const browser = acquireHiddenBrowser();
    const extVersion =
      typeof chrome !== 'undefined' && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest().version
        : 'unknown';
    console.info('[PriceGuard] HiddenBrowser SERP navigate', {
      marketplace,
      searchUrl,
      version: extVersion,
    });

    return await browser.runExclusive(async (nav) => {
      let tabId = await nav(searchUrl);

      await waitForTabComplete(tabId);
      await delay(400);

      // Ozon often redirects /search → /category/…prediction — force global SERP (up to 2 retries)
      if (marketplace === 'ozon') {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const tab = await chrome.tabs.get(tabId);
            const finalUrl = tab.url ?? '';
            if (!/\/category\//i.test(finalUrl)) break;
            console.info('[PriceGuard] Ozon category redirect → re-nav global SERP', {
              attempt: attempt + 1,
              finalUrl: finalUrl.slice(0, 120),
            });
            tabId = await nav(searchUrl);
            await waitForTabComplete(tabId);
            await delay(600);
          } catch {
            break;
          }
        }
      }

      await scrollSearchPage(tabId);
      await ensureContentScript(tabId);

      if (marketplace === 'ozon') {
        // Poll DOM/widgets while tiles hydrate (category pages often lazy-load /product/ links)
        const ozonStarted = Date.now();
        const ozonMaxMs = SERP_POLL_MAX_MS.ozon;
        let ozonAttempt = 0;
        while (Date.now() - ozonStarted < ozonMaxMs) {
          if (ozonAttempt > 0) await delay(SERP_POLL_INTERVAL_MS);
          ozonAttempt += 1;
          if (ozonAttempt === 2 || ozonAttempt === 5) {
            await scrollSearchPage(tabId);
          }

          const fromPageApi = await searchOzonInTab(tabId, query, ref, referencePrice, excludedUrls);
          if (fromPageApi?.error === OZON_ANTIBOT_USER_MESSAGE) {
            noteEmptyScrape(marketplace, 'serp');
            telemetry.warn({
              stage: 'parser',
              name: 'PARSER_ANTIBOT',
              marketplace,
              queryHash: hashQuery(query),
              success: false,
              errorCode: 'ozon_antibot',
              data: { path: 'widgetStates' },
            });
            return fromPageApi;
          }
          if (
            fromPageApi &&
            (fromPageApi.needsManualPick ||
              (isOfferWithPrice(fromPageApi) &&
                fromPageApi.url &&
                isProductPageUrl(fromPageApi.url)) ||
              (fromPageApi.searchCandidates?.length ?? 0) > 0)
          ) {
            return fromPageApi;
          }
        }
      }

      const offer = await pollSearchMessage(
        tabId,
        marketplace,
        query,
        ref,
        referencePrice,
        referenceSpecs,
        excludedUrls,
      );
      if (offer) {
        resetEmptyScrape(marketplace, 'serp');
        // Do not cache pre-cascade SERP
        return offer;
      }

      // Content-script scrape empty — last DOM pass for Ozon (widgets already tried)
      if (marketplace === 'ozon') {
        const fromDom = await scrapeOzonSerpDomInTab(
          tabId,
          query,
          ref,
          referencePrice,
          excludedUrls,
        );
        if (fromDom?.error === OZON_ANTIBOT_USER_MESSAGE) {
          noteEmptyScrape(marketplace, 'serp');
          telemetry.warn({
            stage: 'parser',
            name: 'PARSER_ANTIBOT',
            marketplace,
            queryHash: hashQuery(query),
            success: false,
            errorCode: 'ozon_antibot',
            data: { path: 'dom' },
          });
          return fromDom;
        }
        if (
          fromDom &&
          (fromDom.needsManualPick ||
            (isOfferWithPrice(fromDom) && fromDom.url && isProductPageUrl(fromDom.url)) ||
            (fromDom.searchCandidates?.length ?? 0) > 0)
        ) {
          telemetry.info({
            stage: 'parser',
            name: 'PARSER_USED',
            marketplace,
            queryHash: hashQuery(query),
            success: true,
            data: { path: 'dom', candidates: fromDom.searchCandidates?.length ?? 0 },
          });
          return fromDom;
        }
      }

      noteEmptyScrape(marketplace, 'serp');
      telemetry.warn({
        stage: 'parser',
        name: 'PARSER_EMPTY',
        marketplace,
        queryHash: hashQuery(query),
        success: false,
        errorCode: 'empty_serp',
      });

      return buildSearchNotFoundOffer(
        marketplace,
        query,
        'Подходящий товар в выдаче не найден. Укажите ссылку вручную.',
      );
    });
  } catch (error) {
    return buildSearchNotFoundOffer(marketplace, query, userFacingError(error));
  } finally {
    void releaseHiddenBrowser();
  }
}
