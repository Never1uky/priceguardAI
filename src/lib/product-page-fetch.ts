/**
 * Загрузка карточки товара: разрешение коротких ссылок и парсинг через фоновую вкладку.
 * Используется, когда HTTP API Ozon/Я.Маркет недоступен или ссылка вида /t/…, /cc/….
 */
import { acquireHiddenBrowser, releaseHiddenBrowser } from '@/lib/hidden-browser';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import type { Product } from '@/types/product';
import { detectComparisonMarketplace, normalizeCompareUrl } from '@/utils/comparison-url';
import { isProductPageUrl } from '@/lib/product-match';
import { fetchOzonOfferFromPage } from '@/lib/ozon-offer';
import { fetchYandexOfferFromPage } from '@/lib/yandex-offer';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';
import { buildWbImageUrl } from '@/utils/wb-image';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { OUT_OF_STOCK_ERROR, outOfStockOffer } from '@/lib/out-of-stock';
import { extractArticle } from '@/utils/marketplace';
import {
  noteEmptyScrape,
  resetEmptyScrape,
  shouldSkipTabScrape,
} from '@/lib/empty-scrape-guard';
import { getSharedPriceCache, putSharedPriceCache } from '@/lib/supabase/price-cache';
import { fetchOfferViaPremiumUnlocker } from '@/lib/premium-unlocker-offer';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';
import { ensureContentScriptReady, safeSendMessage } from '@/lib/safe-messaging';

const TAB_LOAD_TIMEOUT_MS = 45_000;
const PRODUCT_PAGE_DELAY_MS = 6_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Страница не загрузилась'));
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

function productToOffer(
  product: Product,
  marketplace: ComparisonMarketplace,
  url: string,
  meta?: { rating?: number | null; reviewCount?: number; specs?: string },
): MarketplaceOffer {
  return {
    marketplace,
    title: product.title,
    price: product.price,
    oldPrice: product.oldPrice,
    basePrice: product.basePrice,
    payPrice: product.payPrice,
    delivery: null,
    rating: normalizeMarketplaceRating(meta?.rating),
    reviewCount: meta?.reviewCount && meta.reviewCount > 0 ? meta.reviewCount : undefined,
    specs: meta?.specs,
    url: toCanonicalProductUrl(url, marketplace),
    imageUrl: product.imageUrl,
    found: product.price > 0,
  };
}

/** Нужно ли разрешать короткую/редиректную ссылку через вкладку */
export function needsUrlResolution(url: string): boolean {
  return /\/t\/[a-zA-Z0-9]+/i.test(url) || /\/cc\/[a-zA-Z0-9]+/i.test(url) || !isProductPageUrl(url);
}

/**
 * Открывает ссылку в фоновой вкладке и возвращает финальный URL карточки.
 */
export async function resolveProductPageUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  const marketplace = detectComparisonMarketplace(trimmed);
  if (!marketplace) return trimmed;

  if (isProductPageUrl(trimmed) && !needsUrlResolution(trimmed)) {
    return normalizeCompareUrl(trimmed);
  }

  const browser = acquireHiddenBrowser();
  try {
    return await browser.runExclusive(async (nav) => {
      const tabId = await nav(trimmed);
      await waitForTabComplete(tabId);
      await delay(2_000);

      const tab = await chrome.tabs.get(tabId);
      const finalUrl = tab.url?.trim() || trimmed;
      return normalizeCompareUrl(finalUrl);
    });
  } finally {
    void releaseHiddenBrowser();
  }
}

async function fetchWildberriesOffer(url: string): Promise<MarketplaceOffer | null> {
  const nmId = url.match(/\/catalog\/(\d+)/i)?.[1];
  if (!nmId) return null;
  const api = await fetchWildberriesProduct(nmId);
  const pageUrl = url.includes('detail')
    ? url
    : `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`;
  if (!api) return null;
  if (!api.price || api.price <= 0) {
    return outOfStockOffer('wildberries', api.title || 'Товар', pageUrl, {
      imageUrl: buildWbImageUrl(nmId),
      rating: normalizeMarketplaceRating(api.reviewRating),
      reviewCount: api.feedbacks,
    });
  }
  return {
    marketplace: 'wildberries',
    title: api.title,
    price: api.price,
    oldPrice: api.oldPrice,
    delivery: api.delivery ?? null,
    rating: normalizeMarketplaceRating(api.reviewRating),
    reviewCount: api.feedbacks,
    url: pageUrl,
    imageUrl: buildWbImageUrl(nmId),
    found: true,
  };
}

/** HTTP API без вкладки */
async function fetchOfferViaApi(
  url: string,
  marketplace: ComparisonMarketplace,
): Promise<MarketplaceOffer | null> {
  if (marketplace === 'wildberries') {
    return fetchWildberriesOffer(url);
  }
  if (marketplace === 'ozon') {
    return fetchOzonOfferFromPage(url);
  }
  return fetchYandexOfferFromPage(url);
}

/** Парсинг карточки через content script на фоновой вкладке */
export async function scrapeOfferViaHiddenTab(
  url: string,
  marketplace: ComparisonMarketplace,
): Promise<MarketplaceOffer | null> {
  const browser = acquireHiddenBrowser();
  try {
    return await browser.runExclusive(async (nav) => {
      const tabId = await nav(url);
      await waitForTabComplete(tabId);
      await delay(PRODUCT_PAGE_DELAY_MS);
      await ensureContentScript(tabId);

      for (const wait of [0, 1_500, 3_000, 5_000]) {
        if (wait) await delay(wait);
        try {
          const response = (await safeSendMessage(
            { type: 'tab', tabId },
            { type: 'SCRAPE_PRODUCT' },
            { retries: 1, reinject: true, softFail: true },
          )) as {
            ok?: boolean;
            product?: Product;
            yandexMeta?: { rating?: number | null; reviewCount?: number; specs?: string };
            pageMeta?: { rating?: number | null; reviewCount?: number; specs?: string };
          } | null;
          if (response?.ok && response.product?.price && response.product.price > 0) {
            const pageUrl = (await chrome.tabs.get(tabId)).url ?? url;
            const meta = response.pageMeta ?? response.yandexMeta;
            return productToOffer(response.product, marketplace, pageUrl, meta);
          }
        } catch {
          // content script ещё не готов
        }
      }

      return null;
    });
  } finally {
    void releaseHiddenBrowser();
  }
}

/**
 * Загрузить оффер: (soft) shared cache → API → (при короткой ссылке) resolve → API → фоновая вкладка
 * → (Premium) серверный Unlocker (Scrappey) через Edge.
 *
 * Shared cache = публичная/серверная цена. HiddenBrowser = сессия Chrome — в shared НЕ пишем.
 * forceTab: не short-circuit на shared cache — сначала API / вкладка.
 */
export interface FetchOfferOptions {
  /** Skip Premium Scrappey unlocker (e.g. pick already has SERP price) */
  skipUnlocker?: boolean;
  /** Always try HiddenBrowser even if card empty-scrape budget is exhausted */
  forceTab?: boolean;
}

export async function fetchOfferWithFallback(
  url: string,
  marketplace: ComparisonMarketplace,
  options: FetchOfferOptions = {},
): Promise<MarketplaceOffer | null> {
  let targetUrl = normalizeCompareUrl(url);

  if (options.forceTab) {
    resetEmptyScrape(marketplace, 'card');
  }

  const trySharedCache = async (urlForId: string) => {
    const productId = extractArticle(urlForId, marketplace);
    if (!productId) return null;
    try {
      const cached = await getSharedPriceCache(marketplace, productId);
      if (cached?.price && cached.price > 0) {
        resetEmptyScrape(marketplace, 'card');
        return {
          marketplace,
          title: cached.title || 'Товар',
          price: cached.price,
          delivery: null,
          rating: normalizeMarketplaceRating(cached.rating),
          url: cached.url || urlForId,
          found: true,
          matchStatus: 'verified' as const,
          imageUrl:
            marketplace === 'wildberries' ? buildWbImageUrl(productId) : undefined,
        } satisfies MarketplaceOffer;
      }
    } catch {
      // cache optional
    }
    return null;
  };

  // Soft cache only when not forcing a live/tab scrape
  let deferredCache: MarketplaceOffer | null = null;
  if (!options.forceTab) {
    const fromCache = await trySharedCache(targetUrl);
    if (fromCache) return fromCache;
  } else {
    deferredCache = await trySharedCache(targetUrl);
  }

  if (needsUrlResolution(targetUrl)) {
    try {
      targetUrl = await resolveProductPageUrl(targetUrl);
    } catch (error) {
      console.warn('[PriceGuard] resolveProductPageUrl:', error);
    }
  }

  const productId = extractArticle(targetUrl, marketplace);

  /** Only public/server sources may poison shared SKU cache — never HiddenBrowser/session. */
  const persistShared = (offer: MarketplaceOffer) => {
    if (!offer.price || offer.price <= 0 || !productId) return;
    void putSharedPriceCache({
      marketplace,
      productId,
      price: offer.price!,
      title: offer.title,
      url: offer.url || targetUrl,
      rating: offer.rating,
    });
  };

  const fromApi = await fetchOfferViaApi(targetUrl, marketplace);
  if (fromApi?.price && fromApi.price > 0) {
    const offer = { ...fromApi, url: targetUrl, found: true };
    persistShared(offer);
    resetEmptyScrape(marketplace, 'card');
    return offer;
  }

  const allowTab = options.forceTab || !shouldSkipTabScrape(marketplace, 'card');
  if (allowTab) {
    try {
      const scraped = await scrapeOfferViaHiddenTab(targetUrl, marketplace);
      if (scraped?.price && scraped.price > 0) {
        // Personal/session price — do NOT write to shared cache
        resetEmptyScrape(marketplace, 'card');
        return scraped;
      }
      if (!options.forceTab) noteEmptyScrape(marketplace, 'card');
    } catch (error) {
      if (!options.forceTab) noteEmptyScrape(marketplace, 'card');
      console.warn('[PriceGuard] scrapeOfferViaHiddenTab:', error);
    }
  }

  // Premium: серверный Unlocker только для карточки (не SERP)
  if (
    !options.skipUnlocker &&
    (marketplace === 'ozon' || marketplace === 'yandex_market' || marketplace === 'wildberries')
  ) {
    try {
      const unlocked = await fetchOfferViaPremiumUnlocker(targetUrl, marketplace);
      if (unlocked?.price && unlocked.price > 0) {
        persistShared(unlocked);
        resetEmptyScrape(marketplace, 'card');
        return unlocked;
      }
    } catch (error) {
      console.warn('[PriceGuard] premium unlocker:', error);
    }
  }

  // forceTab soft fallback: shared cache after live paths failed
  if (options.forceTab && deferredCache) {
    return deferredCache;
  }

  // Страница/API ответили без цены → скорее нет в наличии, чем «не найдено»
  if (fromApi && fromApi.error === OUT_OF_STOCK_ERROR) {
    return { ...fromApi, url: targetUrl, matchStatus: 'oos' };
  }
  if (fromApi?.title && (!fromApi.price || fromApi.price <= 0)) {
    return {
      ...outOfStockOffer(marketplace, fromApi.title, targetUrl, {
        imageUrl: fromApi.imageUrl,
        rating: fromApi.rating,
        reviewCount: fromApi.reviewCount,
      }),
      matchStatus: 'oos',
    };
  }

  return fromApi?.price ? fromApi : null;
}
