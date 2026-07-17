/**
 * Загрузка карточки товара: разрешение коротких ссылок и парсинг через фоновую вкладку.
 * Используется, когда HTTP API Ozon/Я.Маркет недоступен или ссылка вида /t/…, /cc/….
 */
import { getHiddenBrowser } from '@/lib/hidden-browser';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import type { Product } from '@/types/product';
import { detectComparisonMarketplace, normalizeCompareUrl } from '@/utils/comparison-url';
import { isProductPageUrl } from '@/lib/product-match';
import { fetchOzonOfferFromPage } from '@/lib/ozon-offer';
import { fetchYandexOfferFromPage } from '@/lib/yandex-offer';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';
import { buildWbImageUrl } from '@/utils/wb-image';
import { toCanonicalProductUrl } from '@/utils/product-url';

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
    await delay(800);
  } catch {
    // страница может блокировать инъекцию
  }
}

function productToOffer(product: Product, marketplace: ComparisonMarketplace, url: string): MarketplaceOffer {
  return {
    marketplace,
    title: product.title,
    price: product.price,
    oldPrice: product.oldPrice,
    basePrice: product.basePrice,
    payPrice: product.payPrice,
    delivery: null,
    rating: null,
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

  const browser = getHiddenBrowser();
  const tabId = await browser.navigate(trimmed);
  await waitForTabComplete(tabId);
  await delay(2_000);

  const tab = await chrome.tabs.get(tabId);
  const finalUrl = tab.url?.trim() || trimmed;
  return normalizeCompareUrl(finalUrl);
}

async function fetchWildberriesOffer(url: string): Promise<MarketplaceOffer | null> {
  const nmId = url.match(/\/catalog\/(\d+)/i)?.[1];
  if (!nmId) return null;
  const api = await fetchWildberriesProduct(nmId);
  if (!api?.price) return null;
  const pageUrl = url.includes('detail')
    ? url
    : `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`;
  return {
    marketplace: 'wildberries',
    title: api.title,
    price: api.price,
    oldPrice: api.oldPrice,
    delivery: api.delivery ?? null,
    rating: api.reviewRating ?? null,
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
  const browser = getHiddenBrowser();
  const tabId = await browser.navigate(url);
  await waitForTabComplete(tabId);
  await delay(PRODUCT_PAGE_DELAY_MS);
  await ensureContentScript(tabId);

  for (const wait of [0, 1_500, 3_000, 5_000]) {
    if (wait) await delay(wait);
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_PRODUCT' });
      if (response?.ok && response.product?.price > 0) {
        const pageUrl = (await chrome.tabs.get(tabId)).url ?? url;
        return productToOffer(response.product as Product, marketplace, pageUrl);
      }
    } catch {
      // content script ещё не готов
    }
  }

  return null;
}

/**
 * Загрузить оффер: API → (при короткой ссылке) resolve → API → фоновая вкладка
 * → (Premium) Bright Data Unlocker через Edge.
 */
export async function fetchOfferWithFallback(
  url: string,
  marketplace: ComparisonMarketplace,
): Promise<MarketplaceOffer | null> {
  let targetUrl = normalizeCompareUrl(url);

  if (needsUrlResolution(targetUrl)) {
    try {
      targetUrl = await resolveProductPageUrl(targetUrl);
    } catch (error) {
      console.warn('[PriceGuard] resolveProductPageUrl:', error);
    }
  }

  const fromApi = await fetchOfferViaApi(targetUrl, marketplace);
  if (fromApi?.price && fromApi.price > 0) {
    return { ...fromApi, url: targetUrl, found: true };
  }

  try {
    const scraped = await scrapeOfferViaHiddenTab(targetUrl, marketplace);
    if (scraped?.price && scraped.price > 0) {
      return scraped;
    }
  } catch (error) {
    console.warn('[PriceGuard] scrapeOfferViaHiddenTab:', error);
  }

  // Premium: серверный Unlocker только для карточки (не SERP)
  if (marketplace === 'ozon' || marketplace === 'yandex_market' || marketplace === 'wildberries') {
    try {
      const { fetchOfferViaPremiumUnlocker } = await import('@/lib/premium-unlocker-offer');
      const unlocked = await fetchOfferViaPremiumUnlocker(targetUrl, marketplace);
      if (unlocked?.price && unlocked.price > 0) {
        return unlocked;
      }
    } catch (error) {
      console.warn('[PriceGuard] premium unlocker:', error);
    }
  }

  return fromApi?.price ? fromApi : null;
}
