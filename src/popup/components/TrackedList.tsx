import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Surface } from '@/components/ui/surface';
import { PriceHistoryChart } from '@/popup/components/PriceHistoryChart';
import { formatPrice } from '@/lib/utils';
import { setTrackedNotificationsEnabled } from '@/lib/storage';
import { isProductNotificationsEnabled } from '@/lib/notification-settings';
import { MARKETPLACE_SHORT_LABELS, marketplaceBadgeVariant } from '@/utils/marketplace';
import type { PricePoint, TrackedProduct } from '@/types/product';
import { ProductLink } from '@/popup/components/ProductLink';
import { toastSuccess } from '@/popup/lib/toast';
import { Bell, BellOff, ChevronDown, ChevronUp, ExternalLink, Info, Loader2, PackageSearch, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface TrackedListProps {
  products: TrackedProduct[];
  priceHistory: Record<string, PricePoint[]>;
  selectedId: string | null;
  globalNotificationsEnabled?: boolean;
  onSelect: (product: TrackedProduct) => void;
  onRemove: (productId: string) => void | Promise<void>;
  onNotificationsChange?: () => void;
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
}: TrackedListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  if (products.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Пока нет отслеживаемых товаров"
        description="Откройте карточку товара и нажмите «Отслеживать»."
      />
    );
  }

  return (
    <ScrollArea className="h-64 pr-1">
      <div className="space-y-1.5">
        {products.map((product) => {
          const priceDiff = product.price - product.initialPrice;
          const isCheaper = priceDiff < 0;
          const isExpanded = expandedId === product.id;
          const history = priceHistory[product.id] ?? [];
          const isRemoving = removingId === product.id;
          const isConfirming = confirmDeleteId === product.id;
          const isSelected = selectedId === product.id;
          const isInfoOpen = infoId === product.id;

          return (
            <Surface
              key={product.id}
              variant={isSelected ? 'subtle' : 'plain'}
              padding="sm"
              className={`cursor-pointer ${isSelected ? 'bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/50'}`}
              onClick={() => onSelect(product)}
            >
                <div className="flex min-w-0 items-center gap-2.5">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="h-10 w-10 shrink-0 rounded-sm bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] text-muted-foreground">
                      —
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge variant={marketplaceBadgeVariant(product.marketplace)} className="shrink-0 px-1.5 py-0 text-[9px]">
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
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pg-caption">
                      <span className="font-semibold text-foreground">{formatPrice(product.price)}</span>
                      {!isNotifyOn(product) && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          без уведомлений
                        </Badge>
                      )}
                      {product.oldPrice && product.oldPrice > product.price && (
                        <span className="text-muted-foreground line-through">
                          {formatPrice(product.oldPrice)}
                        </span>
                      )}
                      {priceDiff !== 0 && (
                        <span className={isCheaper ? 'text-green-600' : 'text-red-500'}>
                          {isCheaper ? '↓' : '↑'} {formatPrice(Math.abs(priceDiff))}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        · мин. {formatPrice(product.lowestPrice)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-px">
                    <Button
                      variant={isInfoOpen ? 'secondary' : 'ghost'}
                      size="icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setInfoId(isInfoOpen ? null : product.id);
                        if (!isInfoOpen) setExpandedId(null);
                      }}
                      title="Информация о товаре"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={isNotifyOn(product) ? 'text-primary' : 'text-muted-foreground opacity-60'}
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
                    >
                      {isNotifyOn(product) ? (
                        <Bell className="h-3.5 w-3.5" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedId(isExpanded ? null : product.id);
                      }}
                      title="История цен"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <ProductLink
                        url={product.url}
                        marketplace={product.marketplace}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-sm"
                        title="Открыть"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </ProductLink>
                    </Button>
                    <Button
                      variant={isConfirming ? 'destructive' : 'outline'}
                      size="sm"
                      className={`h-8 gap-1 px-2 text-[10px] ${isConfirming ? '' : 'border-destructive/30 text-destructive hover:bg-destructive/10'}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRemove(product);
                      }}
                      disabled={isRemoving}
                      title={isConfirming ? 'Нажмите ещё раз для подтверждения' : 'Удалить из отслеживаемых'}
                    >
                      {isRemoving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {isConfirming ? 'Да' : 'Удалить'}
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
                      <span className="font-medium text-green-600 dark:text-green-400">
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
                    Нажмите корзину ещё раз, чтобы удалить товар
                  </p>
                )}

                {isExpanded && (
                  <div className="mt-3 space-y-3 border-t border-border/60 pt-3" onClick={(e) => e.stopPropagation()}>
                    <PriceHistoryChart history={history} initialPrice={product.initialPrice} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => void handleRemove(product)}
                      disabled={isRemoving}
                    >
                      {isRemoving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {isConfirming ? 'Подтвердить удаление' : 'Удалить из отслеживаемых'}
                    </Button>
                  </div>
                )}
            </Surface>
          );
        })}
      </div>
    </ScrollArea>
  );
}
