/**
 * «Мои товары» — unified tracked ∪ compare list with expand → CompareProductDetail.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { CompareProductDetail } from '@/popup/components/CompareProductDetail';
import { ProductImage } from '@/popup/components/ProductImage';
import { TelegramChannelLink } from '@/popup/components/TelegramChannelLink';
import { useCompareTab } from '@/popup/hooks/useCompareTab';
import {
  ensureCompareShellForTracked,
  getMyProductsSortMode,
  loadMyProductItems,
  migrateMyProductsOnce,
  removeMyProductEntities,
  setMyProductsSortMode,
  type MyProductItem,
  type MyProductsSortMode,
} from '@/lib/my-products';
import {
  setTrackedNotificationsEnabled,
  syncTrackedProductsWithCloud,
  trackProduct,
} from '@/lib/storage';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { RUNNING_IDS_KEY, RUNNING_KEY, SEARCHING_MP_KEY } from '@/lib/compare-jobs';
import { normalizeRunningIds } from '@/lib/compare-running-state';
import { isPremium } from '@/lib/subscription';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/types/subscription';
import { COMPARISON_MARKETPLACE_LABELS, type ComparisonMarketplace } from '@/types/comparison';
import type { Product } from '@/types/product';
import { toastError, toastSuccess } from '@/popup/lib/toast';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageSearch,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

const SORT_LABELS: Record<MyProductsSortMode, string> = {
  addedAt: 'По дате',
  title: 'По названию',
  price: 'По цене',
};

const marketplaceBadge: Record<ComparisonMarketplace, 'wildberries' | 'ozon' | 'yandex'> = {
  wildberries: 'wildberries',
  ozon: 'ozon',
  yandex_market: 'yandex',
};

interface MyProductsTabProps {
  isActive: boolean;
  /** Focus this compare id when opening (deep-link from Current Price) */
  focusCompareId?: string | null;
  /** Clear App focus when user collapses a row */
  onClearFocusCompareId?: () => void;
  liveProduct?: Product | null;
  onAddLiveProduct?: () => void | Promise<void>;
  onOpenAuth?: () => void;
  onRefreshCloud?: () => void | Promise<void>;
  refreshing?: boolean;
}

export function MyProductsTab({
  isActive,
  focusCompareId = null,
  onClearFocusCompareId,
  liveProduct,
  onAddLiveProduct,
  onRefreshCloud,
  refreshing = false,
}: MyProductsTabProps) {
  const [items, setItems] = useState<MyProductItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(focusCompareId);
  const [premium, setPremium] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchingCompareIds, setSearchingCompareIds] = useState<Set<string>>(() => new Set());
  const [sortMode, setSortMode] = useState<MyProductsSortMode>('addedAt');
  const deletingIdRef = useRef<string | null>(null);
  const expandingIdRef = useRef<string | null>(null);
  const lastFocusCompareIdRef = useRef<string | null | undefined>(undefined);

  const compareApi = useCompareTab(isActive, focusId);

  const resolveExpandedIdForFocus = useCallback(
    (list: MyProductItem[], compareFocus: string | null | undefined): string | null => {
      if (!compareFocus) return null;
      const row = list.find((i) => i.compareId === compareFocus);
      return row?.id ?? null;
    },
    [],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await migrateMyProductsOnce();
      const [list, mode] = await Promise.all([loadMyProductItems(), getMyProductsSortMode()]);
      setSortMode(mode);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void isPremium().then(setPremium);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void reload();
  }, [isActive, reload]);

  // Expand only when focusCompareId changes — not on every items reload
  useEffect(() => {
    if (!focusCompareId) {
      lastFocusCompareIdRef.current = focusCompareId;
      return;
    }
    if (lastFocusCompareIdRef.current === focusCompareId) return;
    const rowId = resolveExpandedIdForFocus(items, focusCompareId);
    if (!rowId) {
      // List not ready yet — don't consume focus
      if (items.length === 0) return;
      lastFocusCompareIdRef.current = focusCompareId;
      setFocusId(focusCompareId);
      return;
    }
    lastFocusCompareIdRef.current = focusCompareId;
    setFocusId(focusCompareId);
    setExpandedId(rowId);
  }, [focusCompareId, items, resolveExpandedIdForFocus]);

  useEffect(() => {
    const syncSearching = () => {
      void chrome.storage.local
        .get([RUNNING_KEY, RUNNING_IDS_KEY, SEARCHING_MP_KEY])
        .then((stored) => {
          const fromIds = normalizeRunningIds(stored[RUNNING_IDS_KEY]);
          const ids = fromIds.length ? fromIds : normalizeRunningIds(stored[RUNNING_KEY]);
          const searchingMp = stored[SEARCHING_MP_KEY];
          // Show row spinner while SERP/search progress is marked, for every running id.
          setSearchingCompareIds(
            searchingMp != null && ids.length ? new Set(ids) : new Set(),
          );
        });
    };
    syncSearching();
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[RUNNING_KEY] || changes[RUNNING_IDS_KEY] || changes[SEARCHING_MP_KEY]) {
        syncSearching();
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local') return;
      if (
        changes.priceguard_storage ||
        changes.priceguard_compare_products ||
        changes.priceguard_compare_selected_id
      ) {
        if (deletingIdRef.current) return;
        if (expandingIdRef.current) return;
        void loadMyProductItems().then(setItems);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  const limit = premium ? PREMIUM_LIMITS.maxMyProducts : FREE_LIMITS.maxMyProducts;

  const clearFocus = () => {
    setFocusId(null);
    lastFocusCompareIdRef.current = null;
    onClearFocusCompareId?.();
  };

  const toggleExpand = async (item: MyProductItem) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      clearFocus();
      return;
    }

    expandingIdRef.current = item.id;
    setExpandingId(item.id);
    try {
      let compareId = item.compareId;
      if (!compareId && item.trackedProduct) {
        const shell = await ensureCompareShellForTracked(item.trackedProduct);
        compareId = shell.id;
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? { ...row, compareId: shell.id, compareProduct: shell }
              : row,
          ),
        );
      }
      if (compareId) {
        setFocusId(compareId);
        await compareApi.handleSelect(compareId);
      }
      setExpandedId(item.id);
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Не удалось открыть товар');
    } finally {
      expandingIdRef.current = null;
      setExpandingId(null);
    }
  };

  const handleSortChange = async (mode: MyProductsSortMode) => {
    setSortMode(mode);
    await setMyProductsSortMode(mode);
    setItems(await loadMyProductItems(mode));
  };

  const handleToggleAlerts = async (item: MyProductItem, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setBusyId(item.id);
    try {
      if (item.trackedId) {
        const next = !item.alertsEnabled;
        await setTrackedNotificationsEnabled(item.trackedId, next);
        toastSuccess(next ? 'Оповещения включены' : 'Оповещения выключены');
      } else if (item.compareProduct) {
        // Enable tracking from compare shell
        const cmp = item.compareProduct;
        const product: Product = {
          id:
            cmp.sourceMarketplace === 'wildberries'
              ? `wb-${cmp.article || 'x'}`
              : cmp.sourceMarketplace === 'ozon'
                ? `ozon-${cmp.article || 'x'}`
                : `yandex-${cmp.article || 'x'}`,
          marketplace: cmp.sourceMarketplace,
          title: cmp.title,
          price: cmp.sourceOffer?.price ?? 0,
          currency: '₽',
          article: cmp.article || '',
          url: cmp.sourceUrl,
          imageUrl: cmp.sourceOffer?.imageUrl,
          scrapedAt: Date.now(),
          authenticity: cmp.authenticity,
        };
        await trackProduct(product);
        toastSuccess('Оповещения включены — товар в слежении');
      }
      await reload();
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Не удалось изменить оповещения');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (item: MyProductItem, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm('Удалить товар из «Мои товары»?')) return;
    setBusyId(item.id);
    deletingIdRef.current = item.id;
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    if (expandedId === item.id) {
      setExpandedId(null);
      clearFocus();
    }
    try {
      await removeMyProductEntities(item);
      if (await canUseCloudFeatures()) {
        await syncTrackedProductsWithCloud({ reconcile: true });
      }
      toastSuccess('Товар удалён');
    } catch (error) {
      await reload();
      toastError(error instanceof Error ? error.message : 'Не удалось удалить');
    } finally {
      deletingIdRef.current = null;
      setBusyId(null);
    }
  };

  if (loading && items.length === 0) {
    return (
      <p className="py-8 text-center pg-hint text-muted-foreground">Загрузка…</p>
    );
  }

  return (
    <div className="space-y-3">
      {limit != null && (
        <p className="pg-hint text-center">
          {items.length > limit
            ? `У вас ${items.length} товаров при лимите ${premium ? 'Premium' : 'Free'} ${limit} — новые добавить нельзя, пока не удалите лишние${premium ? '' : ' или не оформите Premium'}`
            : `Мои товары: ${items.length} из ${limit}${!premium && items.length >= limit ? ' · Premium — до 50' : ''}`}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Мои товары</SectionLabel>
        <div className="flex items-center gap-1.5">
          {items.length > 0 && (
            <select
              className="h-7 max-w-[7.5rem] rounded-sm border border-border/60 bg-background px-1.5 text-[10px] text-muted-foreground"
              value={sortMode}
              onChange={(e) => void handleSortChange(e.target.value as MyProductsSortMode)}
              aria-label="Сортировка списка"
            >
              {(Object.keys(SORT_LABELS) as MyProductsSortMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {SORT_LABELS[mode]}
                </option>
              ))}
            </select>
          )}
          {onRefreshCloud && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={() => void onRefreshCloud()}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Обновить
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Пока ничего не отслеживаете"
          description="Откройте карточку на Wildberries и нажмите «Следить за ценой». Сообщим, если подешевеет."
        >
          {liveProduct && onAddLiveProduct && (
            <Button size="sm" className="mt-2" onClick={() => void onAddLiveProduct()}>
              Добавить текущий товар
            </Button>
          )}
          <div className="mt-3 w-full max-w-[260px]">
            <TelegramChannelLink variant="outline" />
          </div>
        </EmptyState>
      ) : (
        <Surface variant="subtle" padding="sm" className="space-y-1.5">
          {items.map((item) => {
            const expanded = expandedId === item.id;
            const showDetail =
              expanded &&
              item.compareId &&
              compareApi.selectedProduct?.id === item.compareId;

            return (
              <div key={item.id} className="rounded-sm">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => void toggleExpand(item)}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void toggleExpand(item);
                    }
                  }}
                  className={`flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-sm p-2.5 text-left pg-transition ${
                    expanded
                      ? 'bg-background shadow-soft ring-1 ring-primary/20'
                      : 'hover:bg-background/60'
                  }`}
                >
                  <ProductImage
                    product={{
                      title: item.title,
                      imageUrl: item.imageUrl,
                      imageUrlAlternatives: item.imageUrlAlternatives,
                    }}
                    className="h-11 w-11 rounded-sm"
                    compact
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 pg-body font-medium leading-snug">{item.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {item.linkedMarketplaces.map((mp) => (
                        <Badge
                          key={mp}
                          variant={marketplaceBadge[mp]}
                          className="px-1.5 py-0 text-[9px]"
                        >
                          {COMPARISON_MARKETPLACE_LABELS[mp].split(' ')[0]}
                        </Badge>
                      ))}
                      {item.article && (
                        <span className="pg-caption text-muted-foreground">
                          · арт. {item.article}
                        </span>
                      )}
                      {item.compareId && searchingCompareIds.has(item.compareId) && (
                        <span className="inline-flex items-center gap-1 pg-caption text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Ищем…
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 flex-col items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={item.alertsEnabled ? 'Оповещения вкл' : 'Оповещения выкл'}
                      disabled={busyId === item.id}
                      onClick={(e) => void handleToggleAlerts(item, e)}
                    >
                      {item.alertsEnabled ? (
                        <Bell className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      title="Удалить"
                      disabled={busyId === item.id}
                      onClick={(e) => void handleRemove(item, e)}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm hover:bg-muted/60"
                    title={expanded ? 'Свернуть' : 'Развернуть'}
                    aria-expanded={expanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleExpand(item);
                    }}
                  >
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>

                {showDetail && (
                  <div className="mt-2 border-t border-border/60 px-1 pt-2">
                    <CompareProductDetail api={compareApi} />
                  </div>
                )}
                {expanded && !showDetail && expandingId === item.id && (
                  <p className="px-2 py-3 text-center pg-hint text-muted-foreground">
                    Открываем сравнение…
                  </p>
                )}
              </div>
            );
          })}
        </Surface>
      )}

      {/* Keep compare job listeners warm even when collapsed */}
      <div className="hidden" aria-hidden>
        {compareApi.selectedProduct?.id}
      </div>
    </div>
  );
}
