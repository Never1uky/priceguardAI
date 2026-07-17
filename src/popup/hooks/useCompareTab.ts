import {
  getCompareProducts,
  getSelectedCompareId,
  removeCompareProduct,
  setSelectedCompareId,
} from '@/lib/comparison-storage';
import { formatComparedAt, hasStoredCompareOffers } from '@/lib/compare-cache';
import { offersFromCompareProduct } from '@/lib/compare-offers';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { useCallback, useEffect, useState } from 'react';

import { SEARCHING_MP_KEY } from '@/lib/compare-jobs';
import type { SearchingMarketplaceKey } from '@/lib/compare-jobs';

const RUNNING_KEY = 'priceguard_compare_running';
const RUNNING_AT_KEY = 'priceguard_compare_running_at';

export function useCompareTab(isActive: boolean) {
  const [products, setProducts] = useState<CompareProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkingMarketplace, setLinkingMarketplace] = useState<ComparisonMarketplace | null>(null);
  const [rejectingMarketplace, setRejectingMarketplace] = useState<ComparisonMarketplace | null>(null);
  const [searchingMarketplace, setSearchingMarketplace] = useState<SearchingMarketplaceKey | null>(null);
  const [selectingMarketplace, setSelectingMarketplace] = useState<ComparisonMarketplace | null>(null);

  const selectedProduct = products.find((p) => p.id === selectedId) ?? null;

  const syncRunningState = useCallback(async (productId: string | null) => {
    const stored = await chrome.storage.local.get([RUNNING_KEY, RUNNING_AT_KEY, SEARCHING_MP_KEY]);
    const runningId = stored[RUNNING_KEY] as string | undefined;
    const startedAt = stored[RUNNING_AT_KEY] as number | undefined;
    const searchingMp = stored[SEARCHING_MP_KEY] as SearchingMarketplaceKey | undefined;

    const stale = startedAt && Date.now() - startedAt > 4 * 60 * 1000;
    if (stale && runningId) {
      await chrome.storage.local.remove([RUNNING_KEY, RUNNING_AT_KEY, SEARCHING_MP_KEY]);
      setIsRefreshing(false);
      setSearchingMarketplace(null);
      return;
    }

    const running = Boolean(productId && runningId === productId);
    setIsRefreshing(running);
    setSearchingMarketplace(running ? searchingMp ?? null : null);
  }, []);

  const loadProducts = useCallback(async () => {
    const [list, selected] = await Promise.all([getCompareProducts(), getSelectedCompareId()]);
    setProducts(list);

    if (selected && list.some((p) => p.id === selected)) {
      setSelectedId(selected);
      await syncRunningState(selected);
    } else {
      const nextId = list[0]?.id ?? null;
      setSelectedId(nextId);
      await syncRunningState(nextId);
    }
  }, [syncRunningState]);

  const applyProduct = useCallback((product: CompareProduct) => {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [product, ...prev];
    });
    setSelectedId(product.id);
    setOffers(offersFromCompareProduct(product));
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void loadProducts();
  }, [isActive, loadProducts]);

  useEffect(() => {
    if (!selectedProduct) {
      setOffers([]);
      return;
    }
    setOffers(offersFromCompareProduct(selectedProduct));
  }, [selectedProduct?.id, selectedProduct?.comparedAt]);

  useEffect(() => {
    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') return;

      if (changes[RUNNING_KEY] || changes[RUNNING_AT_KEY] || changes[SEARCHING_MP_KEY]) {
        const runningId = changes[RUNNING_KEY]?.newValue as string | undefined;
        if (!runningId) {
          setIsRefreshing(false);
          setSearchingMarketplace(null);
          void loadProducts();
        } else {
          setIsRefreshing(Boolean(selectedId && runningId === selectedId));
          const mp = changes[SEARCHING_MP_KEY]?.newValue as SearchingMarketplaceKey | undefined;
          setSearchingMarketplace(mp ?? null);
        }
      }

      if (changes.priceguard_compare_products || changes.priceguard_compare_selected_id) {
        void loadProducts();
      }
    };

    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [loadProducts, selectedId]);

  const refreshCompare = useCallback(
    async (product: CompareProduct, force = true) => {
      setError(null);
      setIsRefreshing(true);

      try {
        const list = await getCompareProducts();
        const fresh = list.find((p) => p.id === product.id) ?? product;

        const response = await sendRuntimeMessage<{
          ok?: boolean;
          error?: string;
          started?: boolean;
          alreadyRunning?: boolean;
        }>({
          type: 'COMPARE_PRICES',
          payload: { product: fresh, force, mode: 'refresh' },
        });

        if (!response?.ok) {
          setError(response?.error ?? 'Не удалось обновить цены');
          setIsRefreshing(false);
          return;
        }

        if (response.started === false && response.alreadyRunning) {
          await syncRunningState(product.id);
          return;
        }
      } catch {
        setError('Ошибка связи с расширением');
        setIsRefreshing(false);
      }
    },
    [syncRunningState],
  );

  const researchCompare = useCallback(
    async (product: CompareProduct) => {
      setError(null);
      setIsRefreshing(true);

      try {
        const response = await sendRuntimeMessage<{
          ok?: boolean;
          error?: string;
          started?: boolean;
          alreadyRunning?: boolean;
        }>({
          type: 'RESEARCH_COMPARE_PRODUCT',
          payload: { productId: product.id },
        });

        if (!response?.ok) {
          setError(response?.error ?? 'Не удалось запустить поиск');
          setIsRefreshing(false);
          return;
        }

        if (response.started === false && response.alreadyRunning) {
          await syncRunningState(product.id);
          return;
        }
      } catch {
        setError('Ошибка связи с расширением');
        setIsRefreshing(false);
      }
    },
    [syncRunningState],
  );

  const handleSelect = async (id: string) => {
    setSelectedId(id);
    await setSelectedCompareId(id);
    await syncRunningState(id);
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm('Удалить товар из списка сравнения?')) return;
    await removeCompareProduct(id);
    if (selectedId === id) {
      setOffers([]);
    }
    await loadProducts();
  };

  const handleManualLink = async (marketplace: ComparisonMarketplace, url: string) => {
    if (!selectedProduct) return;

    setLinkingMarketplace(marketplace);
    setError(null);

    try {
      const response = await sendRuntimeMessage<{
        ok?: boolean;
        error?: string;
        product?: CompareProduct;
      }>({
        type: 'LINK_MARKETPLACE_OFFER',
        payload: { productId: selectedProduct.id, marketplace, url },
      });

      if (!response?.ok || !response.product) {
        throw new Error(response?.error ?? 'Не удалось привязать ссылку');
      }

      applyProduct(response.product);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось привязать ссылку';
      setError(msg);
      throw err;
    } finally {
      setLinkingMarketplace(null);
    }
  };

  const handleRejectOffer = async (marketplace: ComparisonMarketplace, rejectedUrl: string) => {
    if (!selectedProduct) return;

    setRejectingMarketplace(marketplace);
    setError(null);

    try {
      const response = await sendRuntimeMessage<{
        ok?: boolean;
        error?: string;
        product?: CompareProduct;
      }>({
        type: 'REJECT_COMPARE_OFFER',
        payload: { productId: selectedProduct.id, marketplace, rejectedUrl },
      });

      if (!response?.ok || !response.product) {
        throw new Error(response?.error ?? 'Не удалось найти другой товар');
      }

      applyProduct(response.product);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось найти другой товар';
      setError(msg);
      throw err;
    } finally {
      setRejectingMarketplace(null);
    }
  };

  const handleSelectCandidate = async (marketplace: ComparisonMarketplace, url: string) => {
    if (!selectedProduct) return;

    setSelectingMarketplace(marketplace);
    setError(null);

    try {
      const response = await sendRuntimeMessage<{
        ok?: boolean;
        error?: string;
        product?: CompareProduct;
      }>({
        type: 'SELECT_COMPARE_CANDIDATE',
        payload: { productId: selectedProduct.id, marketplace, url },
      });

      if (!response?.ok || !response.product) {
        throw new Error(response?.error ?? 'Не удалось выбрать товар');
      }

      applyProduct(response.product);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось выбрать товар';
      setError(msg);
      throw err;
    } finally {
      setSelectingMarketplace(null);
    }
  };

  const refreshAllComparePrices = useCallback(async () => {
    setError(null);
    setIsRefreshing(true);
    try {
      await sendRuntimeMessage({ type: 'REFRESH_ALL_COMPARE_PRICES' });
      await loadProducts();
    } catch {
      setError('Не удалось обновить цены сравнения');
    } finally {
      setIsRefreshing(false);
      if (selectedId) await syncRunningState(selectedId);
    }
  }, [loadProducts, selectedId, syncRunningState]);

  const foundMarketplacesCount = offers.filter(
    (o) => Boolean(o.price && o.price > 0) && Boolean(o.url) && !/search\?/i.test(o.url),
  ).length;

  return {
    products,
    selectedProduct,
    offers,
    isRefreshing,
    error,
    linkingMarketplace,
    rejectingMarketplace,
    searchingMarketplace,
    selectingMarketplace,
    foundMarketplacesCount,
    hasCache: selectedProduct ? hasStoredCompareOffers(selectedProduct) : false,
    comparedAtLabel: selectedProduct?.comparedAt
      ? formatComparedAt(selectedProduct.comparedAt)
      : null,
    loadProducts,
    applyProduct,
    refreshCompare,
    researchCompare,
    refreshAllComparePrices,
    handleSelect,
    handleRemove,
    handleManualLink,
    handleRejectOffer,
    handleSelectCandidate,
    setError,
  };
}
