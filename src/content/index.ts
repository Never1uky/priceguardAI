import { agentLog } from '@/lib/debug-log';
import { safeRuntimeSend, reloadPageIfExtensionWasUpdated } from '@/lib/extension-context';
import { saveLastScrapedProduct, recordVisitPrice, updateTrackedProductPrice } from '@/lib/storage';
import { scrapeReviews, scrollToReviewsSection } from '@/utils/parsers/reviews';
import { scrapeMarketplaceSearch } from '@/utils/parsers/search-results';
import { detectMarketplace } from '@/utils/marketplace';
import type { ComparisonMarketplace } from '@/types/comparison';
import type { ContentResponse, Product } from '@/types/product';
import { isProductPage, scrapeCurrentPage, scrapeYandexMeta } from '@/utils/parsers';
import { scrapeModelFieldFromDom } from '@/lib/specs-model';
import { showPagePanel } from '@/content/page-panel';

const RETRY_DELAYS_MS = [0, 800, 2000, 4000, 6000];
const OBSERVER_DEBOUNCE_MS = 800;

let lastPublishedKey = '';
let lastPageUrl = '';
let scrapeInFlight = false;

function currentPageKey(): string {
  return window.location.href.split('?')[0].split('#')[0];
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

function resetIfUrlChanged(): boolean {
  const url = currentPageKey();
  if (url === lastPageUrl) return false;
  lastPageUrl = url;
  lastPublishedKey = '';
  notifyProductPageChanged();
  return true;
}

function productFingerprint(product: Product): string {
  return [product.id, product.price, product.oldPrice ?? '', product.title].join('|');
}

async function publishProduct(product: Product): Promise<void> {
  const key = productFingerprint(product);
  if (key === lastPublishedKey) return;
  lastPublishedKey = key;

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

  // Виджет на странице товара
  void showPagePanel(product);
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

async function tryScrape(attempt = 0): Promise<void> {
  if (!isProductPage()) return;

  const product = await scrapeCurrentPage();
  if (product) {
    await publishProduct(product);
    return;
  }

  if (attempt < RETRY_DELAYS_MS.length - 1) {
    window.setTimeout(() => {
      void tryScrape(attempt + 1);
    }, RETRY_DELAYS_MS[attempt + 1]);
  }
}

function observePage(): void {
  let debounceTimer: number | undefined;
  lastPageUrl = currentPageKey();

  const observer = new MutationObserver(() => {
    if (resetIfUrlChanged()) {
      void tryScrape();
      return;
    }

    if (!isProductPage()) return;

    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void scrapeAndPublish();
    }, OBSERVER_DEBOUNCE_MS);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    pushState(...args);
    resetIfUrlChanged();
    window.setTimeout(() => void tryScrape(), 400);
  };

  history.replaceState = (...args) => {
    replaceState(...args);
    resetIfUrlChanged();
    window.setTimeout(() => void tryScrape(), 400);
  };

  window.addEventListener('popstate', () => {
    resetIfUrlChanged();
    window.setTimeout(() => void tryScrape(), 400);
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isProductPage()) {
      resetIfUrlChanged();
      void tryScrape();
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
        ...(pageMeta ? { yandexMeta: pageMeta } : {}),
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

  if (message.type === 'SCRAPE_PRODUCT' || message.type === 'GET_CURRENT_PRODUCT') {
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

      if (marketplace === 'ozon' && allowNavigation) {
        scrollToReviewsSection();
        await new Promise((r) => setTimeout(r, 500));
      }

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
    const offer = scrapeMarketplaceSearch(
      marketplace,
      query,
      referenceTitle,
      referencePrice,
      referenceSpecs,
      excludedUrls,
    );
    sendResponse({ ok: Boolean(offer), offer });
    return true;
  }

  return false;
});

if (isProductPage()) {
  lastPageUrl = currentPageKey();
  void tryScrape();
} else {
  reloadPageIfExtensionWasUpdated();
}

observePage();

console.info('[PriceGuard AI] Content script active', {
  isProductPage: isProductPage(),
  url: window.location.href,
});
