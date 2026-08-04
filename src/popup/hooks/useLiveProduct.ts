/**
 * Живые данные товара с активной вкладки.
 * Обновляется при смене URL (tabs / webNavigation / content SPA) и при scrape.
 */

import { sendRuntimeMessage } from '@/lib/runtime-message';
import { seedProductImageSync } from '@/lib/product-image';
import { getPriceHistory, getStorage } from '@/lib/storage';
import { stableProductStorageId } from '@/lib/price-identity';
import type { Product } from '@/types/product';
import { detectMarketplace, isProductPage } from '@/utils/marketplace';
import { isSameProductPage } from '@/lib/reviews/tab-resolver';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Откуда взяты данные для вкладок «Цена» и «Отзывы» */
export type ProductDataSource = 'current_tab' | 'cached' | 'loading' | 'none';

/** Сколько ждать scrape на карточке, прежде чем уйти в кэш / none */
const PRODUCT_PAGE_WAIT_MS = 10_000;

function normalizePageUrl(url: string): string {
  try {
    const mp = detectMarketplace(url);
    if (mp) return toCanonicalProductUrl(url, mp);
    return url.split('?')[0].split('#')[0];
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function urlsReferToSameProduct(a: string, b: string): boolean {
  return isSameProductPage(a, b);
}

export interface UseLiveProductResult {
  product: Product | null;
  tabUrl: string | null;
  dataSource: ProductDataSource;
  isLoading: boolean;
  error: string | null;
  priceHistory: import('@/types/product').PricePoint[];
  refresh: (options?: { silent?: boolean }) => Promise<void>;
}

export function useLiveProduct(): UseLiveProductResult {
  const [product, setProduct] = useState<Product | null>(null);
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<ProductDataSource>('loading');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<import('@/types/product').PricePoint[]>([]);
  const lastTabUrlRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastSilentRefreshAtRef = useRef(0);
  const productPageWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingSinceRef = useRef<number | null>(null);

  const clearProductPageWait = useCallback(() => {
    if (productPageWaitRef.current != null) {
      clearTimeout(productPageWaitRef.current);
      productPageWaitRef.current = null;
    }
  }, []);

  const applyProduct = useCallback(
    async (next: Product, source: ProductDataSource) => {
      clearProductPageWait();
      loadingSinceRef.current = null;

      // Sync WB CDN seed before first paint — avoids broken img while ensure runs
      const painted = seedProductImageSync(next);

      setProduct(painted);
      setTabUrl(painted.url);
      setDataSource(source);
      setError(null);
      setPriceHistory(await getPriceHistory(stableProductStorageId(painted) ?? painted.id));

      void (async () => {
        try {
          const { ensureProductImage } = await import('@/lib/product-image');
          const withImage = await ensureProductImage(painted, {
            force: !painted.imageUrl,
          });
          if (
            withImage.imageUrl !== painted.imageUrl ||
            (withImage.imageUrlAlternatives?.length ?? 0) >
              (painted.imageUrlAlternatives?.length ?? 0)
          ) {
            setProduct((prev) => (prev?.id === painted.id ? { ...prev, ...withImage } : prev));
          }
        } catch {
          // soft
        }
      })();
    },
    [clearProductPageWait],
  );

  const clearForNavigation = useCallback(
    (nextUrl: string) => {
      clearProductPageWait();
      loadingSinceRef.current = Date.now();
      setProduct(null);
      setDataSource('loading');
      setIsLoading(true);
      setError(null);
      setPriceHistory([]);
      lastTabUrlRef.current = nextUrl;
    },
    [clearProductPageWait],
  );

  const fallbackWhenProductPageEmpty = useCallback(async (tabError?: string, activeTabUrl?: string | null) => {
    const storage = await getStorage();
    const cached = storage.lastScrapedProduct;
    if (
      cached &&
      activeTabUrl &&
      isProductPage(activeTabUrl) &&
      urlsReferToSameProduct(cached.url, activeTabUrl)
    ) {
      await applyProduct(cached, 'cached');
      lastTabUrlRef.current = cached.url;
      setError(
        tabError
          ? `${tabError} — показан кэш этой карточки`
          : 'Не удалось прочитать карточку — показаны данные из кэша',
      );
      return;
    }

    // Product page but cache is another SKU — never show foreign product
    if (activeTabUrl && isProductPage(activeTabUrl)) {
      clearProductPageWait();
      loadingSinceRef.current = null;
      setProduct(null);
      setDataSource('none');
      setPriceHistory([]);
      setError(
        tabError ??
          'Не удалось прочитать карточку — обновите страницу или откройте товар заново',
      );
      return;
    }

    // Не карточка МП — пустой контекст (без lastScraped «чужого» товара)
    clearProductPageWait();
    loadingSinceRef.current = null;
    setProduct(null);
    setDataSource('none');
    setPriceHistory([]);
    setError(null);
  }, [applyProduct, clearProductPageWait]);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;

      if (!options?.silent) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const tabResponse = await sendRuntimeMessage<{
          ok?: boolean;
          product?: Product;
          isProductPage?: boolean;
          error?: string;
          needsRefresh?: boolean;
          source?: 'content' | 'api';
        }>({ type: 'GET_ACTIVE_TAB_PRODUCT' });

        if (tabResponse?.ok && tabResponse.product) {
          const source: ProductDataSource =
            tabResponse.source === 'content' ? 'current_tab' : 'cached';
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          // Не‑карточка (chrome://, новая вкладка и т.п.) — пустой контекст, без чужого кэша
          if (!activeTab?.url || !isProductPage(activeTab.url)) {
            clearProductPageWait();
            loadingSinceRef.current = null;
            setProduct(null);
            setDataSource('none');
            setPriceHistory([]);
            setError(null);
            lastTabUrlRef.current = activeTab?.url ?? null;
            return;
          }
          if (!urlsReferToSameProduct(tabResponse.product.url, activeTab.url)) {
            await fallbackWhenProductPageEmpty(
              'Карточка на вкладке не совпала с кэшем',
              activeTab.url,
            );
            return;
          }
          await applyProduct(tabResponse.product, source);
          lastTabUrlRef.current = tabResponse.product.url;
          return;
        }

        if (tabResponse?.isProductPage) {
          const { getRunningCompareProductId } = await import('@/lib/compare-jobs');
          const compareRunning = await getRunningCompareProductId();

          if (!compareRunning) {
            setProduct(null);
            setDataSource('loading');
            if (loadingSinceRef.current == null) {
              loadingSinceRef.current = Date.now();
            }
          }

          setError(tabResponse.error ?? 'Данные товара загружаются…');

          const waited =
            loadingSinceRef.current != null
              ? Date.now() - loadingSinceRef.current
              : 0;

          if (!tabResponse.needsRefresh || waited >= PRODUCT_PAGE_WAIT_MS) {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            await fallbackWhenProductPageEmpty(tabResponse.error, activeTab?.url);
            return;
          }

          clearProductPageWait();
          productPageWaitRef.current = setTimeout(() => {
            void (async () => {
              await refresh({ silent: true });
            })();
          }, Math.max(500, PRODUCT_PAGE_WAIT_MS - waited));

          return;
        }

        clearProductPageWait();
        loadingSinceRef.current = null;
        setProduct(null);
        setDataSource('none');
        setPriceHistory([]);
        setError(null);
        lastTabUrlRef.current = null;
      } catch {
        setError('Не удалось загрузить данные');
        setDataSource((prev) => (prev === 'loading' ? 'none' : prev));
      } finally {
        setIsLoading(false);
        refreshInFlightRef.current = false;
      }
    },
    [applyProduct, clearProductPageWait, fallbackWhenProductPageEmpty],
  );

  useEffect(() => {
    void refresh();

    const onTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active || !tab.url) return;

      if (changeInfo.url) {
        const nextNorm = normalizePageUrl(changeInfo.url);
        const prevNorm = lastTabUrlRef.current
          ? normalizePageUrl(lastTabUrlRef.current)
          : null;

        if (
          prevNorm &&
          nextNorm !== prevNorm &&
          !urlsReferToSameProduct(changeInfo.url, lastTabUrlRef.current!)
        ) {
          clearForNavigation(changeInfo.url);
        }
      }

      if (
        (changeInfo.status === 'complete' || changeInfo.url) &&
        isProductPage(tab.url)
      ) {
        const now = Date.now();
        if (now - lastSilentRefreshAtRef.current < 2_500) return;
        lastSilentRefreshAtRef.current = now;
        void refresh({ silent: changeInfo.url == null });
      }
    };

    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') return;

      if (changes.priceguard_storage) {
        const nextStorage = changes.priceguard_storage.newValue as {
          lastScrapedProduct?: Product;
        } | undefined;
        const scraped = nextStorage?.lastScrapedProduct;
        if (!scraped) return;

        void (async () => {
          try {
            const { getRunningCompareProductId } = await import('@/lib/compare-jobs');
            if (await getRunningCompareProductId()) return;
          } catch {
            // soft
          }

          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          const activeUrl = activeTab?.url;
          if (!activeUrl || !isProductPage(activeUrl)) return;
          if (!urlsReferToSameProduct(scraped.url, activeUrl)) return;

          const currentUrl = lastTabUrlRef.current;
          if (currentUrl && !urlsReferToSameProduct(scraped.url, currentUrl)) {
            return;
          }

          void applyProduct(scraped, 'current_tab');
          lastTabUrlRef.current = scraped.url;
          setIsLoading(false);
        })();
      }
    };

    const onRuntimeMessage = (message: {
      type?: string;
      payload?: { url?: string; tabId?: number; isProductPage?: boolean };
    }) => {
      if (message.type !== 'PRODUCT_PAGE_CHANGED') return;

      void (async () => {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab?.url) return;

        const payloadTabId = message.payload?.tabId;
        if (payloadTabId != null && activeTab.id !== payloadTabId) return;

        const url = message.payload?.url ?? activeTab.url;
        if (!url || !isProductPage(url)) return;

        const nextNorm = normalizePageUrl(url);
        const prevNorm = lastTabUrlRef.current
          ? normalizePageUrl(lastTabUrlRef.current)
          : null;

        if (
          prevNorm &&
          nextNorm !== prevNorm &&
          !urlsReferToSameProduct(url, lastTabUrlRef.current!)
        ) {
          clearForNavigation(url);
        }

        void refresh({ silent: true });
      })();
    };

    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.storage.onChanged.addListener(onStorageChange);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    return () => {
      clearProductPageWait();
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.storage.onChanged.removeListener(onStorageChange);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    };
  }, [applyProduct, clearForNavigation, clearProductPageWait, refresh]);

  return {
    product,
    tabUrl,
    dataSource,
    isLoading,
    error,
    priceHistory,
    refresh,
  };
}
