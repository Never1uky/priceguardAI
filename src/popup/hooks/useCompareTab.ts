import {
  getCompareProducts,
  getSelectedCompareId,
  removeCompareProduct,
  setSelectedCompareId,
} from '@/lib/comparison-storage';
import { formatComparedAt, hasStoredCompareOffers } from '@/lib/compare-cache';
import { offersFromCompareProduct } from '@/lib/compare-offers';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import { trackMatchManualSelection, trackMonitoringRefresh, classifyFailureReason } from '@/lib/telemetry/funnel';
import { getSelectedSearchMarketplaces } from '@/lib/marketplaces/search-settings';
import type { MarketplaceId } from '@/lib/marketplaces/registry';
import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { useCallback, useEffect, useState } from 'react';

import {
  RUNNING_AT_KEY,
  RUNNING_AT_MAP_KEY,
  RUNNING_IDS_KEY,
  RUNNING_KEY,
  SEARCHING_MP_KEY,
} from '@/lib/compare-jobs';
import type { SearchingMarketplaceKey } from '@/lib/compare-jobs';
import { normalizeRunningAtMap, normalizeRunningIds, pruneStaleRunning } from '@/lib/compare-running-state';

const RUNNING_STALE_MS = 4 * 60 * 1000;

function readRunningIdsFromStore(stored: Record<string, unknown>): string[] {
  const fromIds = normalizeRunningIds(stored[RUNNING_IDS_KEY]);
  return fromIds.length ? fromIds : normalizeRunningIds(stored[RUNNING_KEY]);
}

export function useCompareTab(isActive: boolean, focusCompareId?: string | null) {
  const [products, setProducts] = useState<CompareProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkingMarketplace, setLinkingMarketplace] = useState<ComparisonMarketplace | null>(null);
  const [rejectingMarketplace, setRejectingMarketplace] = useState<ComparisonMarketplace | null>(null);
  const [searchingMarketplace, setSearchingMarketplace] = useState<SearchingMarketplaceKey | null>(null);
  const [selectingMarketplace, setSelectingMarketplace] = useState<ComparisonMarketplace | null>(null);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<MarketplaceId[]>([]);

  useEffect(() => {
    void getSelectedSearchMarketplaces().then(setSelectedMarketplaces);
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes.priceguard_search_marketplaces_v1) return;
      void getSelectedSearchMarketplaces().then(setSelectedMarketplaces);
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  const selectedProduct = products.find((p) => p.id === selectedId) ?? null;

  const syncRunningState = useCallback(async (productId: string | null) => {
    const stored = await chrome.storage.local.get([
      RUNNING_KEY,
      RUNNING_IDS_KEY,
      RUNNING_AT_KEY,
      RUNNING_AT_MAP_KEY,
      SEARCHING_MP_KEY,
    ]);
    const ids = readRunningIdsFromStore(stored);
    const startedAt = normalizeRunningAtMap(
      stored[RUNNING_AT_MAP_KEY] ?? stored[RUNNING_AT_KEY],
      ids,
      Date.now(),
    );
    const searchingMp = stored[SEARCHING_MP_KEY] as SearchingMarketplaceKey | undefined;

    const pruned = pruneStaleRunning(ids, startedAt, Date.now(), RUNNING_STALE_MS);
    if (pruned.pruned.length) {
      // Defer cleanup to compare-jobs getRunning*; locally just reflect non-stale.
    }

    const running = Boolean(productId && pruned.ids.includes(productId));
    setIsRefreshing(running);
    setSearchingMarketplace(running ? searchingMp ?? null : null);
  }, []);

  const loadProducts = useCallback(async () => {
    const [list, selected] = await Promise.all([getCompareProducts(), getSelectedCompareId()]);
    setProducts(list);

    const preferred =
      (focusCompareId && list.some((p) => p.id === focusCompareId) && focusCompareId) ||
      (selected && list.some((p) => p.id === selected) && selected) ||
      list[0]?.id ||
      null;

    setSelectedId(preferred);
    if (preferred) await setSelectedCompareId(preferred);
    await syncRunningState(preferred);

    // Soft hydrate missing thumbs after list paint
    void (async () => {
      try {
        const { hydrateCompareImages } = await import('@/lib/product-image');
        const { saveCompareProducts } = await import('@/lib/comparison-storage');
        await hydrateCompareImages(list, async (updated) => {
          await saveCompareProducts(updated);
          setProducts(updated);
        });
      } catch {
        // soft
      }
    })();
  }, [syncRunningState, focusCompareId]);

  const applyProduct = useCallback(
    (product: CompareProduct) => {
      setProducts((prev) => {
        const exists = prev.some((p) => p.id === product.id);
        return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [product, ...prev];
      });
      setSelectedId(product.id);
      setOffers(
        offersFromCompareProduct(product, {
          marketplaces: selectedMarketplaces.length ? selectedMarketplaces : undefined,
        }),
      );
    },
    [selectedMarketplaces],
  );

  useEffect(() => {
    if (!isActive) return;
    void loadProducts();

    // X3: drain offline pick queue (max 3 due items)
    void (async () => {
      try {
        const {
          peekDuePickRetries,
          dequeuePickRetry,
          markPickRetryFailure,
        } = await import('@/lib/pick-retry-queue');
        const queue = await peekDuePickRetries(3);
        for (const item of queue) {
          try {
            const response = await sendRuntimeMessage<{
              ok?: boolean;
              product?: CompareProduct;
              error?: string;
            }>({
              type: 'SELECT_COMPARE_CANDIDATE',
              payload: {
                productId: item.productId,
                marketplace: item.marketplace,
                url: item.url,
                title: item.title,
                price: item.price,
              },
            });
            if (response?.ok && response.product) {
              applyProduct(response.product);
              await dequeuePickRetry(item);
            } else {
              await markPickRetryFailure(item);
            }
          } catch {
            await markPickRetryFailure(item);
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [isActive, loadProducts, applyProduct]);

  useEffect(() => {
    if (!selectedProduct) {
      setOffers([]);
      return;
    }
    // Depend on selectedProduct identity (updates when storage reloads marketplaceOffers /
    // needs_choice), not only id+comparedAt — otherwise picker never refreshes mid-research.
    setOffers(
      offersFromCompareProduct(selectedProduct, {
        marketplaces: selectedMarketplaces.length ? selectedMarketplaces : undefined,
      }),
    );
  }, [selectedProduct, selectedMarketplaces]);

  useEffect(() => {
    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') return;

      if (
        changes[RUNNING_KEY] ||
        changes[RUNNING_IDS_KEY] ||
        changes[RUNNING_AT_KEY] ||
        changes[RUNNING_AT_MAP_KEY] ||
        changes[SEARCHING_MP_KEY]
      ) {
        void (async () => {
          let runningIds: string[] = [];
          try {
            const stored = await chrome.storage.local.get([
              RUNNING_KEY,
              RUNNING_IDS_KEY,
              RUNNING_AT_KEY,
              RUNNING_AT_MAP_KEY,
              SEARCHING_MP_KEY,
            ]);
            const ids = readRunningIdsFromStore(stored);
            const startedAt = normalizeRunningAtMap(
              stored[RUNNING_AT_MAP_KEY] ?? stored[RUNNING_AT_KEY],
              ids,
              Date.now(),
            );
            runningIds = pruneStaleRunning(ids, startedAt, Date.now(), RUNNING_STALE_MS).ids;
          } catch {
            runningIds = [];
          }

          if (!runningIds.length) {
            setIsRefreshing(false);
            setSearchingMarketplace(null);
            void loadProducts();
          } else {
            const forSelected = Boolean(selectedId && runningIds.includes(selectedId));
            setIsRefreshing(forSelected);
            if (forSelected) {
              const mp = changes[SEARCHING_MP_KEY]?.newValue as SearchingMarketplaceKey | undefined;
              if (mp !== undefined) {
                setSearchingMarketplace(mp ?? null);
              } else {
                try {
                  const stored = await chrome.storage.local.get(SEARCHING_MP_KEY);
                  setSearchingMarketplace(
                    (stored[SEARCHING_MP_KEY] as SearchingMarketplaceKey | undefined) ?? null,
                  );
                } catch {
                  setSearchingMarketplace(null);
                }
              }
            } else {
              setSearchingMarketplace(null);
            }
          }
        })();
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

        if (response == null) {
          setError('Нет ответа от расширения — закройте и откройте popup снова');
          setIsRefreshing(false);
          return;
        }

        if (!response.ok) {
          setError(response.error ?? 'Не удалось запустить поиск');
          setIsRefreshing(false);
          return;
        }

        if (response.started === false && response.alreadyRunning) {
          await syncRunningState(product.id);
          return;
        }

        await syncRunningState(product.id);
      } catch {
        setError('Ошибка связи с расширением — перезагрузите popup');
        setIsRefreshing(false);
      }
    },
    [syncRunningState],
  );

  const researchMarketplace = useCallback(
    async (product: CompareProduct, marketplace: ComparisonMarketplace) => {
      setError(null);
      setIsRefreshing(true);

      try {
        const response = await sendRuntimeMessage<{
          ok?: boolean;
          error?: string;
          started?: boolean;
          alreadyRunning?: boolean;
        }>({
          type: 'RESEARCH_SINGLE_MARKETPLACE',
          payload: { productId: product.id, marketplace },
        });

        if (response == null) {
          setError('Нет ответа от расширения — закройте и откройте popup снова');
          setIsRefreshing(false);
          return;
        }

        if (!response.ok) {
          setError(response.error ?? 'Не удалось запустить поиск');
          setIsRefreshing(false);
          return;
        }

        if (response.started === false && response.alreadyRunning) {
          await syncRunningState(product.id);
          return;
        }

        await syncRunningState(product.id);
      } catch {
        setError('Ошибка связи с расширением — перезагрузите popup');
        setIsRefreshing(false);
      }
    },
    [syncRunningState],
  );

  const handleSelect = async (id: string) => {
    setSelectedId(id);
    await setSelectedCompareId(id);
    await syncRunningState(id);

    const product = products.find((p) => p.id === id);
    if (!product) return;
    try {
      const { ensureCompareProductImage, getCompareProductImageSources } = await import(
        '@/lib/product-image'
      );
      if (getCompareProductImageSources(product).imageUrl) return;
      const withImage = await ensureCompareProductImage(product, { force: true });
      if (getCompareProductImageSources(withImage).imageUrl) {
        const { updateCompareProduct } = await import('@/lib/comparison-storage');
        await updateCompareProduct(withImage);
        applyProduct(withImage);
      }
    } catch {
      // soft
    }
  };

  useEffect(() => {
    if (!isActive || !focusCompareId) return;
    if (selectedId === focusCompareId) return;
    if (!products.some((p) => p.id === focusCompareId)) return;
    void handleSelect(focusCompareId);
    // handleSelect intentionally omitted — focus id drives selection once per focus change
  }, [focusCompareId, isActive, products, selectedId]);

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

    const { resolveCompareCandidateUrl } = await import('@/utils/comparison-url');
    const resolvedUrl = resolveCompareCandidateUrl(url, marketplace);

    const linkOnce = async (confirmed?: boolean) =>
      sendRuntimeMessage<{
        ok?: boolean;
        error?: string;
        needsConfirm?: boolean;
        product?: CompareProduct;
      }>({
        type: 'LINK_MARKETPLACE_OFFER',
        payload: { productId: selectedProduct.id, marketplace, url: resolvedUrl, confirmed },
      });

    try {
      let response = await linkOnce();

      if (response?.needsConfirm) {
        const ok = window.confirm(
          response.error ??
            'Похоже, это другой товар. Привязать эту ссылку всё равно?',
        );
        if (!ok) {
          throw new Error('Привязка отменена');
        }
        response = await linkOnce(true);
      }

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

  const handleRejectCandidate = async (marketplace: ComparisonMarketplace, rejectedUrl: string) => {
    if (!selectedProduct) return;

    setRejectingMarketplace(marketplace);
    setError(null);

    try {
      const response = await sendRuntimeMessage<{
        ok?: boolean;
        error?: string;
        product?: CompareProduct;
      }>({
        type: 'REJECT_COMPARE_CANDIDATE',
        payload: { productId: selectedProduct.id, marketplace, rejectedUrl },
      });

      if (!response?.ok || !response.product) {
        throw new Error(response?.error ?? 'Не удалось отклонить вариант');
      }

      applyProduct(response.product);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось отклонить вариант';
      setError(msg);
      throw err;
    } finally {
      setRejectingMarketplace(null);
    }
  };

  const handleSelectCandidate = async (
    marketplace: ComparisonMarketplace,
    url: string,
    hint?: { title?: string; price?: number | null; rating?: number | null },
  ) => {
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
        payload: {
          productId: selectedProduct.id,
          marketplace,
          url,
          title: hint?.title,
          price: hint?.price,
          rating: hint?.rating,
        },
      });

      if (!response?.ok || !response.product) {
        throw new Error(response?.error ?? 'Не удалось выбрать товар');
      }

      applyProduct(response.product);
      trackMatchManualSelection(marketplace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось выбрать товар';
      const network =
        /сеть|network|failed to fetch|timeout|связ/i.test(msg) ||
        msg.includes('ComparePickNetworkError');
      if (network && selectedProduct) {
        const { enqueuePickRetry } = await import('@/lib/pick-retry-queue');
        await enqueuePickRetry({
          productId: selectedProduct.id,
          marketplace,
          url,
          title: hint?.title,
          price: hint?.price,
        });
        setError('Сеть недоступна — повтор при следующем открытии');
      } else {
        setError(msg);
      }
      throw err;
    } finally {
      setSelectingMarketplace(null);
    }
  };

  const refreshAllComparePrices = useCallback(async () => {
    setError(null);
    setIsRefreshing(true);
    const started = Date.now();
    try {
      await sendRuntimeMessage({ type: 'REFRESH_ALL_COMPARE_PRICES' });
      await loadProducts();
      trackMonitoringRefresh(true, Date.now() - started);
    } catch (error) {
      setError('Не удалось обновить цены сравнения');
      trackMonitoringRefresh(false, Date.now() - started, classifyFailureReason(error));
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
    searchMarketplacesCount: selectedMarketplaces.length || offers.length,
    hasCache: selectedProduct
      ? hasStoredCompareOffers(
          selectedProduct,
          selectedMarketplaces.length ? selectedMarketplaces : undefined,
        )
      : false,
    comparedAtLabel: selectedProduct?.comparedAt
      ? formatComparedAt(selectedProduct.comparedAt)
      : null,
    loadProducts,
    applyProduct,
    refreshCompare,
    researchCompare,
    researchMarketplace,
    refreshAllComparePrices,
    handleSelect,
    handleRemove,
    handleManualLink,
    handleRejectOffer,
    handleRejectCandidate,
    handleSelectCandidate,
    setError,
  };
}
