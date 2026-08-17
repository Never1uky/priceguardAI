import { agentLog } from '@/lib/debug-log';
import { safeRuntimeSend, reloadPageIfExtensionWasUpdated } from '@/lib/extension-context';
import {
  saveLastScrapedProduct,
  recordVisitPrice,
  updateTrackedProductPrice,
} from '@/lib/storage-local';
import { scrapeReviews } from '@/utils/parsers/reviews';
import { scrapeMarketplaceSearch } from '@/utils/parsers/search-results';
import { detectMarketplace } from '@/utils/marketplace';
import type { ComparisonMarketplace } from '@/types/comparison';
import type { ContentResponse, Product } from '@/types/product';
import { isProductPage, scrapeCurrentPage, scrapeYandexMeta } from '@/utils/parsers';
import { scrapeModelFieldFromDom } from '@/lib/specs-model';

const RETRY_DELAYS_MS = [0, 800, 2000, 4000, 6000];
const OBSERVER_DEBOUNCE_MS = 800;

let lastPublishedKey = '';
let lastPageUrl = '';
let scrapeInFlight = false;
/** Invalidates pending retries / debounce when SPA navigates away. */
let scrapeGeneration = 0;
let pendingRetryTimer: number | undefined;
let debounceTimer: number | undefined;
let pageObserver: MutationObserver | null = null;

function currentPageKey(): string {
  return window.location.href.split('?')[0].split('#')[0];
}

function bumpScrapeGeneration(): void {
  scrapeGeneration += 1;
  if (pendingRetryTimer !== undefined) {
    window.clearTimeout(pendingRetryTimer);
    pendingRetryTimer = undefined;
  }
  if (debounceTimer !== undefined) {
    window.clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
}

function notifyProductPageChanged(): void {
  void safeRuntimeSend({
    type: 'PRODUCT_PAGE_CHANGED',
    payload: {
      url: window.location.href,
      isProductPage: isProductPage(),
    },
  });
}

function disconnectPageObserver(): void {
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
}

function connectPageObserver(): void {
  if (pageObserver || !isProductPage()) return;

  pageObserver = new MutationObserver(() => {
    if (resetIfUrlChanged()) return;
    if (!isProductPage()) {
      disconnectPageObserver();
      return;
    }

    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void scrapeAndPublish();
    }, OBSERVER_DEBOUNCE_MS);
  });

  // Узже: childList на body, без characterData на весь document
  const root = document.body ?? document.documentElement;
  pageObserver.observe(root, {
    childList: true,
    subtree: true,
  });
}

function resetIfUrlChanged(): boolean {
  const url = currentPageKey();
  if (url === lastPageUrl) return false;
  lastPageUrl = url;
  lastPublishedKey = '';
  bumpScrapeGeneration();
  notifyProductPageChanged();

  if (isProductPage()) {
    connectPageObserver();
    void scheduleScrape(0);
  } else {
    disconnectPageObserver();
  }
  return true;
}

function productFingerprint(product: Product): string {
  return [product.id, product.price, product.oldPrice ?? '', product.title].join('|');
}

async function publishProduct(product: Product): Promise<void> {
  const key = productFingerprint(product);
  if (key === lastPublishedKey) return;
  lastPublishedKey = key;

  // Hidden browser SERP/card tabs must not pollute «Цены» / lastScraped / PRICE_DROP
  const hiddenCtx = await safeRuntimeSend<{ ok?: boolean; hidden?: boolean }>({
    type: 'IS_HIDDEN_BROWSER_CONTEXT',
  });
  if (hiddenCtx?.hidden) {
    // On-demand SCRAPE_PRODUCT still works; auto-publish is UI-only
    return;
  }

  await saveLastScrapedProduct(product);
  // История цен при каждом визите (как Palert / Keepa)
  await recordVisitPrice(product);
  const priceChange = await updateTrackedProductPrice(product);

  void safeRuntimeSend({ type: 'PRODUCT_SCRAPED', payload: product });

  if (priceChange?.dropped) {
    void safeRuntimeSend({
      type: 'PRICE_DROP',
      payload: { product, previousPrice: priceChange.previousPrice },
    });
  }
}

async function scrapeAndPublish(): Promise<Product | null> {
  if (!isProductPage() || scrapeInFlight) return null;

  scrapeInFlight = true;
  try {
    const product = await scrapeCurrentPage();
    if (product) {
      await publishProduct(product);
    }
    return product;
  } finally {
    scrapeInFlight = false;
  }
}

/** Единый планировщик scrape + retries с generation guard. */
async function scheduleScrape(attempt = 0): Promise<void> {
  if (!isProductPage() || scrapeInFlight) return;
  const gen = scrapeGeneration;

  const product = await scrapeAndPublish();
  if (scrapeGeneration !== gen) return;
  if (product) return;

  if (attempt < RETRY_DELAYS_MS.length - 1) {
    pendingRetryTimer = window.setTimeout(() => {
      if (scrapeGeneration !== gen) return;
      void scheduleScrape(attempt + 1);
    }, RETRY_DELAYS_MS[attempt + 1]);
  }
}

function observePage(): void {
  lastPageUrl = currentPageKey();

  if (isProductPage()) {
    connectPageObserver();
  }

  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    pushState(...args);
    resetIfUrlChanged();
  };

  history.replaceState = (...args) => {
    replaceState(...args);
    resetIfUrlChanged();
  };

  window.addEventListener('popstate', () => {
    resetIfUrlChanged();
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isProductPage()) {
      if (!resetIfUrlChanged()) {
        void scheduleScrape(0);
      }
    }
  });
}

function respondWithProduct(sendResponse: (response: ContentResponse) => void): void {
  void scrapeCurrentPage().then(async (product) => {
    agentLog('content/index.ts:respondWithProduct', 'scrape result', {
      url: window.location.href.slice(0, 120),
      isProductPage: isProductPage(),
      hasProduct: !!product,
      price: product?.price ?? null,
      title: product?.title?.slice(0, 60) ?? null,
    }, 'B');
    if (product) {
      await publishProduct(product);
      const yandexMeta = scrapeYandexMeta();
      const modelField = scrapeModelFieldFromDom();
      const specsParts = [
        modelField ? `Модель: ${modelField}` : null,
        yandexMeta?.specs ?? null,
      ].filter(Boolean) as string[];

      const pageMeta =
        specsParts.length || yandexMeta
          ? {
              rating: yandexMeta?.rating ?? null,
              reviewCount: yandexMeta?.reviewCount,
              specs: specsParts.length ? specsParts.join(' · ') : yandexMeta?.specs,
            }
          : undefined;

      sendResponse({
        ok: true,
        product,
        ...(pageMeta ? { yandexMeta: pageMeta, pageMeta } : {}),
      } as ContentResponse);
      return;
    }

    sendResponse({
      ok: false,
      error: isProductPage()
        ? 'Товар на странице найден, но данные ещё загружаются'
        : 'Откройте страницу товара на Wildberries, Ozon или Яндекс.Маркет',
      isProductPage: isProductPage(),
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'SCRAPE_PRODUCT') {
    respondWithProduct(sendResponse);
    return true;
  }

  if (message.type === 'SCRAPE_REVIEWS') {
    void (async () => {
      const marketplace = detectMarketplace(window.location.href);
      if (!marketplace) {
        sendResponse({ ok: false, error: 'Страница не поддерживается' });
        return;
      }

      const filter = (message.filter as import('@/types/review-analysis').ReviewFilter) ?? 'all';
      const allowNavigation = message.allowNavigation === true;

      const result = await scrapeReviews(marketplace, filter, { allowNavigation });
      sendResponse({
        ok: true,
        reviews: result.reviews.map((r) => r.text),
        totalFound: result.totalFound,
      });
    })();
    return true;
  }

  if (message.type === 'SCRAPE_MARKETPLACE_SEARCH') {
    const marketplace = message.marketplace as ComparisonMarketplace;
    const query = (message.query as string) ?? '';
    const referenceTitle = (message.referenceTitle as string | undefined) ?? query;
    const referencePrice = message.referencePrice as number | undefined;
    const referenceSpecs = message.referenceSpecs as string | undefined;
    const excludedUrls = message.excludedUrls as string[] | undefined;
    const excludedFingerprints = message.excludedFingerprints as string[] | undefined;
    const offer = scrapeMarketplaceSearch(
      marketplace,
      query,
      referenceTitle,
      referencePrice,
      referenceSpecs,
      excludedUrls,
      excludedFingerprints,
    );
    sendResponse({ ok: Boolean(offer), offer });
    return true;
  }

  return false;
});

reloadPageIfExtensionWasUpdated();

if (isProductPage()) {
  lastPageUrl = currentPageKey();
  void scheduleScrape(0);
}

observePage();

console.info('[PriceGuard AI] Content script active', {
  isProductPage: isProductPage(),
  url: window.location.href,
});
