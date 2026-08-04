import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Surface } from '@/components/ui/surface';
import { PriceHistoryChart } from '@/popup/components/PriceHistoryChart';
import { formatPrice } from '@/lib/utils';
import { setTrackedNotificationsEnabled } from '@/lib/storage';
import { isProductNotificationsEnabled } from '@/lib/notification-settings';
import { stableProductStorageId } from '@/lib/price-identity';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import { MARKETPLACE_SHORT_LABELS, marketplaceBadgeVariant } from '@/utils/marketplace';
import type { PricePoint, TrackedProduct } from '@/types/product';
import { ProductLink } from '@/popup/components/ProductLink';
import { ProductImage } from '@/popup/components/ProductImage';
import { toastError, toastSuccess } from '@/popup/lib/toast';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  Loader2,
  PackageSearch,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface TrackedListProps {
  products: TrackedProduct[];
  priceHistory: Record<string, PricePoint[]>;
  selectedId: string | null;
  globalNotificationsEnabled?: boolean;
  onSelect: (product: TrackedProduct) => void;
  onRemove: (productId: string) => void | Promise<void>;
  onNotificationsChange?: () => void;
  collapseAllSignal?: number;
}

const marketplaceLabels = MARKETPLACE_SHORT_LABELS;

export function TrackedList({
  products,
  priceHistory,
  selectedId,
  globalNotificationsEnabled = true,
  onSelect,
  onRemove,
  onNotificationsChange,
  collapseAllSignal = 0,
}: TrackedListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetDraft, setTargetDraft] = useState('');
  const [savingTargetId, setSavingTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (collapseAllSignal > 0) {
      setExpandedId(null);
      setInfoId(null);
      setEditingTargetId(null);
    }
  }, [collapseAllSignal]);

  const handleRemove = async (product: TrackedProduct) => {
    if (confirmDeleteId !== product.id) {
      setConfirmDeleteId(product.id);
      return;
    }

    setRemovingId(product.id);
    setConfirmDeleteId(null);

    try {
      await onRemove(product.id);
      if (expandedId === product.id) setExpandedId(null);
      toastSuccess('Товар удалён из отслеживаемых');
    } finally {
      setRemovingId(null);
    }
  };

  const handleToggleNotifications = async (product: TrackedProduct) => {
    if (!globalNotificationsEnabled) return;
    const next = !isProductNotificationsEnabled(product);
    await setTrackedNotificationsEnabled(product.id, next);
    onNotificationsChange?.();
  };

  const isNotifyOn = (product: TrackedProduct) =>
    globalNotificationsEnabled && isProductNotificationsEnabled(product);

  const startEditTarget = (product: TrackedProduct) => {
    setEditingTargetId(product.id);
    setTargetDraft(product.targetPrice != null ? String(product.targetPrice) : '');
  };

  const saveTarget = async (product: TrackedProduct) => {
    const raw = targetDraft.trim();
    const value = raw === '' ? 0 : Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (raw !== '' && (!Number.isFinite(value) || value < 0)) {
      toastError('Введите корректную целевую цену');
      return;
    }

    setSavingTargetId(product.id);
    try {
      await sendRuntimeMessage({
        type: 'SET_TARGET_PRICE',
        payload: { productId: product.id, targetPrice: value },
      });
      setEditingTargetId(null);
      onNotificationsChange?.();
      toastSuccess(value > 0 ? 'Целевая цена сохранена' : 'Целевая цена сброшена');
    } catch {
      toastError('Не удалось сохранить целевую цену');
    } finally {
      setSavingTargetId(null);
    }
  };

  if (products.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Пока нет отслеживаемых товаров"
        description="Добавьте товар по ссылке или откройте карточку и включите «Следить за ценой»."
      />
    );
  }

  return (
    <ScrollArea className="h-72 pr-1">
      <div className="space-y-1.5">
        {products.map((product) => {
          const isExpanded = expandedId === product.id;
          const historyKey = stableProductStorageId(product) ?? product.id;
          const history = priceHistory[historyKey] ?? priceHistory[product.id] ?? [];
          const isRemoving = removingId === product.id;
          const isConfirming = confirmDeleteId === product.id;
          const isSelected = selectedId === product.id;
          const isInfoOpen = infoId === product.id;
          const isEditingTarget = editingTargetId === product.id;

          return (
            <Surface
              key={product.id}
              variant={isSelected ? 'subtle' : 'plain'}
              padding="sm"
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`Выбрать ${product.title}`}
              className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? 'bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/50'}`}
              onClick={() => onSelect(product)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(product);
                }
              }}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <ProductImage product={product} className="h-11 w-11 rounded-sm" compact />

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Badge
                      variant={marketplaceBadgeVariant(product.marketplace)}
                      className="shrink-0 px-1.5 py-0 text-[9px]"
                    >
                      {marketplaceLabels[product.marketplace]}
                    </Badge>
                    <ProductLink
                      url={product.url}
                      marketplace={product.marketplace}
                      className="truncate pg-body font-medium hover:text-primary"
                      title="Открыть товар"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {product.title}
                    </ProductLink>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <p className="pg-caption">Текущая</p>
                      <p className="text-[12px] font-semibold tabular-nums text-foreground">
                        {formatPrice(product.price)}
                      </p>
                    </div>
                    <div>
                      <p className="pg-caption">Минимальная</p>
                      <p className="text-[12px] font-semibold tabular-nums text-success">
                        {formatPrice(product.lowestPrice)}
                      </p>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <p className="pg-caption">Целевая</p>
                      {isEditingTarget ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={targetDraft}
                            onChange={(e) => setTargetDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void saveTarget(product);
                              }
                              if (e.key === 'Escape') setEditingTargetId(null);
                            }}
                            aria-label="Целевая цена"
                            className="w-full min-w-0 rounded-sm border border-border bg-background px-1.5 py-0.5 text-[11px] tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[10px]"
                            disabled={savingTargetId === product.id}
                            onClick={() => void saveTarget(product)}
                          >
                            {savingTargetId === product.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'OK'
                            )}
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-left text-[12px] font-semibold tabular-nums text-primary hover:underline"
                          onClick={() => startEditTarget(product)}
                          title="Задать целевую цену"
                        >
                          {product.targetPrice && product.targetPrice > 0
                            ? formatPrice(product.targetPrice)
                            : '—'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!isNotifyOn(product) && (
                    <Badge variant="outline" className="h-4 w-fit px-1 text-[9px]">
                      без уведомлений
                    </Badge>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-center gap-px">
                  <Button
                    variant={isInfoOpen ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setInfoId(isInfoOpen ? null : product.id);
                      if (!isInfoOpen) setExpandedId(null);
                    }}
                    title="Информация о товаре"
                    aria-label="Информация о товаре"
                    aria-pressed={isInfoOpen}
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={
                      isNotifyOn(product) ? 'text-primary' : 'text-muted-foreground opacity-60'
                    }
                    disabled={!globalNotificationsEnabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleToggleNotifications(product);
                    }}
                    title={
                      !globalNotificationsEnabled
                        ? 'Уведомления выключены глобально'
                        : isProductNotificationsEnabled(product)
                          ? 'Выключить уведомления'
                          : 'Включить уведомления'
                    }
                    aria-label={
                      !globalNotificationsEnabled
                        ? 'Уведомления выключены глобально'
                        : isProductNotificationsEnabled(product)
                          ? 'Выключить уведомления'
                          : 'Включить уведомления'
                    }
                    aria-pressed={isNotifyOn(product)}
                  >
                    {isNotifyOn(product) ? (
                      <Bell className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <BellOff className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedId(isExpanded ? null : product.id);
                      if (!isExpanded) setInfoId(null);
                    }}
                    title="История цен"
                    aria-label="История цен"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                  <Button variant="ghost" size="icon-sm" asChild>
                    <ProductLink
                      url={product.url}
                      marketplace={product.marketplace}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-sm"
                      title="Открыть"
                      aria-label="Открыть товар"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </ProductLink>
                  </Button>
                  <Button
                    variant={isConfirming ? 'destructive' : 'ghost'}
                    size="icon-sm"
                    className={isConfirming ? '' : 'text-destructive hover:bg-destructive/10'}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRemove(product);
                    }}
                    disabled={isRemoving}
                    title={
                      isConfirming
                        ? 'Нажмите ещё раз для подтверждения'
                        : 'Удалить из отслеживаемых'
                    }
                    aria-label={
                      isConfirming ? 'Подтвердить удаление' : 'Удалить из отслеживаемых'
                    }
                  >
                    {isRemoving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>

              {isInfoOpen && (
                <div
                  className="mt-2.5 space-y-1.5 rounded-sm bg-muted/50 p-2.5 pg-caption"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p>
                    <span className="text-muted-foreground">Артикул:</span>{' '}
                    <span className="font-medium">{product.article || '—'}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Стартовая цена:</span>{' '}
                    <span className="font-medium">{formatPrice(product.initialPrice)}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Минимум:</span>{' '}
                    <span className="font-medium text-success">
                      {formatPrice(product.lowestPrice)}
                    </span>
                  </p>
                  <ProductLink
                    url={product.url}
                    marketplace={product.marketplace}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Открыть карточку
                    <ExternalLink className="h-3 w-3" />
                  </ProductLink>
                </div>
              )}

              {isConfirming && !isInfoOpen && (
                <p className="mt-2 pg-caption font-medium text-destructive">
                  Нажмите ещё раз, чтобы удалить товар
                </p>
              )}

              {isExpanded && (
                <div
                  className="mt-3 space-y-2 border-t border-border/60 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="pg-subtitle">История цены</p>
                  <PriceHistoryChart history={history} initialPrice={product.initialPrice} />
                </div>
              )}
            </Surface>
          );
        })}
      </div>
    </ScrollArea>
  );
}
