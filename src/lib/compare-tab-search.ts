/**
 * Поиск товара через фоновую вкладку: открывает выдачу, парсит карточки, выбирает лучший match.
 * Также: уже открытая карточка MP (не SERP) — scrape + match → verified / needs_choice.
 */
import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import type { Product } from '@/types/product';
import {
  buildMarketplaceSearchUrl,
  detectComparisonMarketplace,
  isMarketplaceSerpUrl,
  serpSearchQueryRelated,
} from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { isProductPage } from '@/utils/marketplace';
import { buildSearchNotFoundOffer } from '@/utils/parsers/search-results';
import { userFacingError } from '@/lib/fetch-retry';
import {
  acquireHiddenBrowser,
  isHiddenBrowserTab,
  releaseHiddenBrowser,
} from '@/lib/hidden-browser';
import { waitForTabComplete } from '@/lib/tab-complete';
import { searchOzonInTab } from '@/lib/ozon-tab-search';
import { isOfferWithPrice, normalizeMarketplaceRating } from '@/lib/compare-offers';
import {
  AUTO_PICK_CONFIDENCE_THRESHOLD,
  computeMatchConfidence,
  isProductPageUrl,
  isUrlExcluded,
  scoreProductMatch,
} from '@/lib/product-match';
import { getSerpCachedOffer } from '@/lib/serp-cache';
import { noteEmptyScrape, resetEmptyScrape, shouldSkipTabScrape } from '@/lib/empty-scrape-guard';
import {
  OZON_ANTIBOT_USER_MESSAGE,
  scrapeOzonSerpDomInTab,
} from '@/lib/ozon-serp-dom';
import { ensureContentScriptReady, safeSendMessage } from '@/lib/safe-messaging';
import { TAB_SEARCH_ADAPTERS } from '@/lib/marketplaces/adapter-config';
import { hashQuery, telemetry } from '@/lib/telemetry';

/** Max open product cards to scrape per marketplace during compare. */
const MAX_OPEN_PRODUCT_TABS = 3;

const TAB_LOAD_TIMEOUT_MS = 35_000;
/** Poll after load until cards appear (instead of long fixed delays). */
const SERP_POLL_INTERVAL_MS = 500;
const SERP_POLL_MAX_MS: Record<ComparisonMarketplace, number> = {
  wildberries: 6_000,
  ozon: 7_000,
  yandex_market: 6_500,
  ...Object.fromEntries(TAB_SEARCH_ADAPTERS.map((a) => [a.id, a.serpPollMs])),
} as Record<ComparisonMarketplace, number>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitSearchTab(tabId: number): Promise<void> {
  await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS, 'Страница поиска не загрузилась');
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
  excludedFingerprints?: string[],
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
      excludedFingerprints,
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
  excludedFingerprints?: string[],
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
      excludedFingerprints,
    );
    if (offer) return offer;
  }

  return null;
}

/** Scrape an already-loaded SERP tab (visible or HiddenBrowser). */
async function scrapeLoadedSerpTab(
  tabId: number,
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
  excludedFingerprints?: string[],
): Promise<MarketplaceOffer | null> {
  await scrollSearchPage(tabId);
  await ensureContentScript(tabId);

  if (marketplace === 'ozon') {
    const ozonStarted = Date.now();
    const ozonMaxMs = SERP_POLL_MAX_MS.ozon;
    let ozonAttempt = 0;
    while (Date.now() - ozonStarted < ozonMaxMs) {
      if (ozonAttempt > 0) await delay(SERP_POLL_INTERVAL_MS);
      ozonAttempt += 1;
      if (ozonAttempt === 2 || ozonAttempt === 5) {
        await scrollSearchPage(tabId);
      }

      const fromPageApi = await searchOzonInTab(tabId, query, referenceTitle, referencePrice, excludedUrls);
      if (fromPageApi?.error === OZON_ANTIBOT_USER_MESSAGE) {
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
      referenceTitle,
      referencePrice,
      referenceSpecs,
      excludedUrls,
      excludedFingerprints,
    );
  if (offer) return offer;

  if (marketplace === 'ozon') {
    const fromDom = await scrapeOzonSerpDomInTab(
      tabId,
      query,
      referenceTitle,
      referencePrice,
      excludedUrls,
    );
    if (fromDom?.error === OZON_ANTIBOT_USER_MESSAGE) {
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

  return null;
}

const SERP_TAB_URL_PATTERNS: Record<ComparisonMarketplace, string[]> = {
  wildberries: ['*://*.wildberries.ru/*search*'],
  ozon: ['*://*.ozon.ru/search*'],
  yandex_market: ['*://market.yandex.ru/search*'],
  ...Object.fromEntries(TAB_SEARCH_ADAPTERS.map((a) => [a.id, a.serpTabPatterns])),
} as Record<ComparisonMarketplace, string[]>;

/** Broad patterns; filtered with isProductPage after query. */
const PRODUCT_TAB_URL_PATTERNS: Record<ComparisonMarketplace, string[]> = {
  wildberries: ['*://*.wildberries.ru/catalog/*'],
  ozon: [
    '*://*.ozon.ru/product/*',
    '*://*.ozon.ru/context/detail/*',
    '*://*.ozon.ru/t/*',
  ],
  yandex_market: [
    '*://market.yandex.ru/card/*',
    '*://market.yandex.ru/product/*',
    '*://market.yandex.ru/product--*',
    '*://market.yandex.ru/cc/*',
  ],
  ...Object.fromEntries(
    TAB_SEARCH_ADAPTERS.map((a) => [
      a.id,
      a.hostSuffixes.flatMap((h) => [`*://*.${h}/*`, `*://${h}/*`]),
    ]),
  ),
} as Record<ComparisonMarketplace, string[]>;

export async function findOpenMarketplaceSerpTab(
  marketplace: ComparisonMarketplace,
  query: string,
): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;

  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: SERP_TAB_URL_PATTERNS[marketplace] });
  } catch {
    return null;
  }

  const candidates = tabs.filter((tab) => {
    if (!tab.id || !tab.url) return false;
    if (isHiddenBrowserTab(tab.id, tab.windowId)) return false;
    if (!isMarketplaceSerpUrl(tab.url, marketplace)) return false;
    return serpSearchQueryRelated(tab.url, query);
  });

  const active = candidates.find((tab) => tab.active);
  return (active ?? candidates[0])?.id ?? null;
}

/**
 * Already-open product cards for this MP (not SERP). Active tab first.
 */
export async function findOpenMarketplaceProductTabs(
  marketplace: ComparisonMarketplace,
): Promise<chrome.tabs.Tab[]> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return [];

  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: PRODUCT_TAB_URL_PATTERNS[marketplace] ?? [] });
  } catch {
    return [];
  }

  const productTabs = tabs.filter((tab) => {
    if (!tab.id || !tab.url) return false;
    if (isHiddenBrowserTab(tab.id, tab.windowId)) return false;
    if (detectComparisonMarketplace(tab.url) !== marketplace) return false;
    if (isMarketplaceSerpUrl(tab.url, marketplace)) return false;
    return isProductPage(tab.url) && isProductPageUrl(tab.url);
  });

  productTabs.sort((a, b) => Number(b.active) - Number(a.active));
  return productTabs.slice(0, MAX_OPEN_PRODUCT_TABS);
}

/** Pure: scraped open card → verified or needs_choice (score ≤ 0 → null). */
export function offerFromOpenProductScrape(params: {
  marketplace: ComparisonMarketplace;
  product: Product;
  pageUrl: string;
  referenceTitle: string;
  referenceSpecs?: string;
  meta?: { rating?: number | null; reviewCount?: number; specs?: string };
  excludedUrls?: string[];
}): MarketplaceOffer | null {
  const {
    marketplace,
    product,
    pageUrl,
    referenceTitle,
    referenceSpecs,
    meta,
    excludedUrls,
  } = params;
  const title = product.title?.trim();
  if (!title || title === 'Товар') return null;

  const url = toCanonicalProductUrl(pageUrl || product.url, marketplace);
  if (!url || !isProductPageUrl(url)) return null;
  if (excludedUrls?.length && isUrlExcluded(url, excludedUrls)) return null;

  const score = scoreProductMatch(referenceTitle, title, referenceSpecs);
  if (score <= 0) return null;

  const confidence = computeMatchConfidence(referenceTitle, title, referenceSpecs);
  const price = product.price > 0 ? product.price : null;
  const rating = normalizeMarketplaceRating(meta?.rating);
  const candidate: SearchCandidateOffer = {
    title: title.slice(0, 200),
    url,
    price,
    matchConfidence: confidence,
    imageUrl: product.imageUrl,
    rating: rating ?? undefined,
  };

  if (confidence >= AUTO_PICK_CONFIDENCE_THRESHOLD && price != null && price > 0) {
    return {
      marketplace,
      title,
      price,
      oldPrice: product.oldPrice,
      basePrice: product.basePrice,
      payPrice: product.payPrice,
      delivery: null,
      rating,
      reviewCount: meta?.reviewCount && meta.reviewCount > 0 ? meta.reviewCount : undefined,
      specs: meta?.specs,
      url,
      imageUrl: product.imageUrl,
      found: true,
      matchConfidence: confidence,
      matchStatus: 'verified',
      searchCandidates: [candidate],
    };
  }

  return {
    marketplace,
    title,
    price,
    delivery: null,
    rating,
    reviewCount: meta?.reviewCount && meta.reviewCount > 0 ? meta.reviewCount : undefined,
    specs: meta?.specs,
    url,
    imageUrl: product.imageUrl,
    found: false,
    needsManualPick: true,
    matchConfidence: confidence,
    matchStatus: 'needs_choice',
    searchCandidates: [candidate],
    error: 'Выберите товар или укажите ссылку',
  };
}

async function scrapeProductFromOpenTab(
  tabId: number,
  _marketplace: ComparisonMarketplace,
): Promise<{
  product: Product;
  pageUrl: string;
  meta?: { rating?: number | null; reviewCount?: number; specs?: string };
} | null> {
  try {
    await ensureContentScriptReady(tabId);
    const response = (await safeSendMessage(
      { type: 'tab', tabId },
      { type: 'SCRAPE_PRODUCT' },
      { retries: 2, reinject: true, softFail: true, backoffMs: [300, 700] },
    )) as {
      ok?: boolean;
      product?: Product;
      yandexMeta?: { rating?: number | null; reviewCount?: number; specs?: string };
      pageMeta?: { rating?: number | null; reviewCount?: number; specs?: string };
    } | null;

    if (!response?.ok || !response.product) return null;
    const tab = await chrome.tabs.get(tabId);
    const pageUrl = tab.url ?? response.product.url ?? '';
    if (!pageUrl) return null;
    return {
      product: response.product,
      pageUrl,
      meta: response.pageMeta ?? response.yandexMeta,
    };
  } catch {
    return null;
  }
}

/**
 * If the user already has this MP's product card open, scrape it and bind / offer picker.
 * Stronger signal than SERP — runs before visible/hidden search tabs.
 */
export async function searchViaOpenProductTab(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referenceSpecs?: string,
  excludedUrls?: string[],
): Promise<MarketplaceOffer | null> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const tabs = await findOpenMarketplaceProductTabs(marketplace);
  if (!tabs.length) return null;

  const ranked: Array<{ offer: MarketplaceOffer; score: number }> = [];
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const scraped = await scrapeProductFromOpenTab(tab.id, marketplace);
    if (!scraped) continue;
    const offer = offerFromOpenProductScrape({
      marketplace,
      product: scraped.product,
      pageUrl: scraped.pageUrl,
      referenceTitle: ref,
      referenceSpecs,
      meta: scraped.meta,
      excludedUrls,
    });
    if (!offer) continue;
    const score = scoreProductMatch(ref, offer.title, referenceSpecs);
    ranked.push({ offer, score });
  }

  if (!ranked.length) return null;
  ranked.sort((a, b) => b.score - a.score);

  const best = ranked[0]!;
  if (ranked.length === 1) {
    console.info('[PriceGuard] Open product tab match', {
      marketplace,
      matchStatus: best.offer.matchStatus,
      confidence: best.offer.matchConfidence,
    });
    return best.offer;
  }

  // Merge multiple open matching cards into one picker pool
  const candidates: SearchCandidateOffer[] = ranked.flatMap((r) =>
    r.offer.searchCandidates ?? [],
  );
  if (
    best.offer.matchStatus === 'verified' &&
    best.offer.found &&
    isOfferWithPrice(best.offer)
  ) {
    return {
      ...best.offer,
      searchCandidates: candidates.slice(0, MAX_OPEN_PRODUCT_TABS),
    };
  }

  return {
    marketplace,
    title: best.offer.title,
    price: best.offer.price,
    delivery: null,
    rating: best.offer.rating,
    url: best.offer.url,
    imageUrl: best.offer.imageUrl,
    found: false,
    needsManualPick: true,
    matchConfidence: best.offer.matchConfidence,
    matchStatus: 'needs_choice',
    searchCandidates: candidates.slice(0, MAX_OPEN_PRODUCT_TABS),
    error:
      candidates.length > 1
        ? `Выберите товар (${candidates.length})`
        : 'Выберите товар или укажите ссылку',
  };
}

/**
 * If the user is already on this marketplace's search page, scrape that tab
 * instead of opening HiddenBrowser (and instead of unofficial search APIs).
 * Returns null when there is no matching tab or scrape is empty — caller falls through.
 */
export async function searchViaOpenSerpTab(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
  excludedFingerprints?: string[],
): Promise<MarketplaceOffer | null> {
  if (shouldSkipTabScrape(marketplace, 'serp')) return null;

  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const tabId = await findOpenMarketplaceSerpTab(marketplace, query);
  if (tabId == null) return null;

  try {
    console.info('[PriceGuard] SERP scrape visible tab', { marketplace, tabId });
    await waitSearchTab(tabId);
    const offer = await scrapeLoadedSerpTab(
      tabId,
      marketplace,
      query,
      ref,
      referencePrice,
      referenceSpecs,
      excludedUrls,
      excludedFingerprints,
    );
    if (offer && isUsableSearchOffer(offer)) {
      resetEmptyScrape(marketplace, 'serp');
      return offer;
    }
    if (offer && (offer.searchCandidates?.length ?? 0) > 0) {
      resetEmptyScrape(marketplace, 'serp');
      return offer;
    }
    noteEmptyScrape(marketplace, 'serp');
  } catch {
    // fall through to HiddenBrowser — do not burn SERP budget on transient tab errors
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
  excludedFingerprints?: string[],
): Promise<MarketplaceOffer> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const searchUrl = buildMarketplaceSearchUrl(marketplace, query);

  if (shouldSkipTabScrape(marketplace, 'serp')) {
    return buildSearchNotFoundOffer(
      marketplace,
      query,
      'Поиск временно пропущен — пустая выдача на этой площадке',
    );
  }

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

  const browser = acquireHiddenBrowser();
  try {
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

      await waitSearchTab(tabId);
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
            await waitSearchTab(tabId);
            await delay(600);
          } catch {
            break;
          }
        }
      }

      const scraped = await scrapeLoadedSerpTab(
        tabId,
        marketplace,
        query,
        ref,
        referencePrice,
        referenceSpecs,
        excludedUrls,
        excludedFingerprints,
      );
      if (scraped?.error === OZON_ANTIBOT_USER_MESSAGE) {
        noteEmptyScrape(marketplace, 'serp');
        telemetry.warn({
          stage: 'parser',
          name: 'PARSER_ANTIBOT',
          marketplace,
          queryHash: hashQuery(query),
          success: false,
          errorCode: 'ozon_antibot',
        });
        return scraped;
      }
      if (scraped && isUsableSearchOffer(scraped)) {
        resetEmptyScrape(marketplace, 'serp');
        return scraped;
      }
      if (scraped && (scraped.searchCandidates?.length ?? 0) > 0) {
        resetEmptyScrape(marketplace, 'serp');
        return scraped;
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
        'Точного совпадения нет. Проверьте похожие варианты: название, цвет и память.',
      );
    });
  } catch (error) {
    return buildSearchNotFoundOffer(marketplace, query, userFacingError(error));
  } finally {
    void releaseHiddenBrowser(browser);
  }
}
