import { AuthenticityHint } from '@/popup/components/AuthenticityHint';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { PriceHistoryChart } from '@/popup/components/PriceHistoryChart';
import { ProductImage } from '@/popup/components/ProductImage';
import { analyzePriceHistory } from '@/lib/price-insights';
import { formatDate, formatPrice, paymentDiscountLabel } from '@/lib/utils';
import { MARKETPLACE_LABELS, marketplaceBadgeVariant } from '@/utils/marketplace';
import type { PricePoint, Product } from '@/types/product';
import { ProductLink } from '@/popup/components/ProductLink';
import {
  BellOff,
  ExternalLink,
  Info,
  PackagePlus,
  RefreshCw,
  Search,
  Shield,
  TrendingDown,
} from 'lucide-react';

interface CurrentPriceTabProps {
  product: Product | null;
  isTracked: boolean;
  isLoading: boolean;
  priceHistory: PricePoint[];
  error: string | null;
  onTrack: () => void;
  onUntrack: () => void;
  /** Единый add + research → «Мои товары» */
  onAddToMyProducts: () => void;
  isComparePending?: boolean;
  fullAnalysisBusy?: boolean;
}

const marketplaceLabels = MARKETPLACE_LABELS;

export function CurrentPriceTab({
  product,
  isTracked,
  isLoading,
  priceHistory,
  error,
  onTrack,
  onUntrack,
  onAddToMyProducts,
  isComparePending = false,
  fullAnalysisBusy = false,
}: CurrentPriceTabProps) {
  if (isLoading && !product) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-primary" strokeWidth={1.75} />
        <p className="pg-hint">Загрузка товара…</p>
      </div>
    );
  }

  if (!product) {
    return (
      <Surface variant="subtle" padding="lg" className="text-center">
        <p className="pg-body text-muted-foreground">
          {error ?? 'Откройте карточку товара на Wildberries, Ozon или Яндекс.Маркет'}
        </p>
      </Surface>
    );
  }

  const displayPrice = product.basePrice ?? product.price;
  const discount =
    product.oldPrice && product.oldPrice > displayPrice
      ? Math.round((1 - displayPrice / product.oldPrice) * 100)
      : null;

  const insight = analyzePriceHistory(priceHistory, displayPrice, product.oldPrice);
  const insightTone: Record<string, string> = {
    great_deal: 'bg-success/10 text-success',
    good_price: 'bg-success/10 text-success',
    average: 'bg-muted text-muted-foreground',
    high_price: 'bg-destructive/10 text-destructive',
    fake_discount: 'bg-warning/10 text-warning',
    unconfirmed_strikethrough: 'bg-warning/10 text-warning',
  };

  return (
    <div className="space-y-4">
      <AuthenticityHint marketplace={product.marketplace} authenticity={product.authenticity} />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={marketplaceBadgeVariant(product.marketplace)}>
              {marketplaceLabels[product.marketplace]}
            </Badge>
            <span className="pg-caption">{formatDate(product.scrapedAt)}</span>
          </div>

          <div className="flex gap-3">
            <ProductImage product={product} className="h-24 w-24 rounded-md shadow-soft" />
            <div className="min-w-0 flex-1 space-y-2">
              <h2 className="line-clamp-3 pg-title text-[16px]">{product.title}</h2>
              <p className="pg-caption">Арт. {product.article}</p>
              <div>
                <p className="inline-flex items-center gap-1 pg-caption text-muted-foreground">
                  Текущая цена
                  <Info className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                </p>
                <div className="mt-1 flex flex-wrap items-end gap-2">
                  <span className="text-[28px] font-semibold leading-none tracking-tight text-primary tabular-nums">
                    {formatPrice(displayPrice)}
                  </span>
                  {product.oldPrice && product.oldPrice > displayPrice && (
                    <>
                      <span className="pg-body text-muted-foreground line-through">
                        {formatPrice(product.oldPrice)}
                      </span>
                      {discount && (
                        <span className="inline-flex items-center gap-0.5 rounded-sm bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                          <TrendingDown className="h-3 w-3" strokeWidth={1.75} />−{discount}%
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {(product.marketplace === 'yandex_market' || product.marketplace === 'ozon') &&
            product.payPrice != null &&
            product.basePrice != null &&
            product.payPrice < product.basePrice && (
              <p className="pg-caption text-emerald-700 dark:text-emerald-400">
                {product.marketplace === 'ozon' ? 'С другими банками' : 'Цена по карте'}{' '}
                {formatPrice(product.basePrice)} · {paymentDiscountLabel(product.marketplace)}{' '}
                {formatPrice(product.payPrice)}
              </p>
            )}
          {(product.marketplace === 'yandex_market' || product.marketplace === 'ozon') &&
            product.payPrice != null &&
            product.basePrice == null && (
              <p className="pg-caption text-emerald-700 dark:text-emerald-400">
                Цена {paymentDiscountLabel(product.marketplace)} {formatPrice(product.payPrice)}
                {product.oldPrice ? ` · было ${formatPrice(product.oldPrice)}` : ''}
              </p>
            )}
          {product.marketplace === 'yandex_market' &&
            product.basePrice != null &&
            !product.payPrice && (
              <p className="pg-caption text-muted-foreground">Цена по карте</p>
            )}
          {product.marketplace === 'ozon' &&
            product.basePrice != null &&
            !product.payPrice && (
              <p className="pg-caption text-muted-foreground">С другими банками</p>
            )}

          {priceHistory.length > 0 && (
            <div
              className={`rounded-sm px-3 py-2.5 ${insightTone[insight.kind] ?? insightTone.average}`}
            >
              <p className="pg-subtitle">{insight.label}</p>
              <p className="pg-hint mt-0.5 opacity-90">{insight.detail}</p>
            </div>
          )}

          <Surface
            variant="subtle"
            padding="sm"
            className="flex items-center gap-3 bg-primary/5 ring-1 ring-primary/15"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-primary/10">
              <Shield className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="pg-subtitle">Следить за ценой</p>
              <p className="pg-hint mt-0.5">
                Уведомим, если товар подешевеет
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isTracked}
              aria-label={isTracked ? 'Отключить отслеживание' : 'Включить отслеживание'}
              disabled={isLoading}
              onClick={() => (isTracked ? onUntrack() : onTrack())}
              className={`relative h-6 w-11 shrink-0 rounded-full pg-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                isTracked ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-soft pg-transition ${
                  isTracked ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </Surface>

          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              onClick={onAddToMyProducts}
              disabled={isLoading || isComparePending || fullAnalysisBusy}
            >
              {isComparePending ? (
                <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : isTracked ? (
                <Search className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <PackagePlus className="h-4 w-4" strokeWidth={1.75} />
              )}
              {isComparePending
                ? 'Добавляем и ищем…'
                : isTracked
                  ? 'Обновить поиск'
                  : 'В «Мои товары»'}
            </Button>
            {isTracked && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={onUntrack}
                disabled={isLoading || isComparePending}
              >
                <BellOff className="h-4 w-4" strokeWidth={1.75} />
                Убрать из «Мои»
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" size="icon" asChild className="h-9 w-9">
              <ProductLink
                url={product.url}
                marketplace={product.marketplace}
                className="inline-flex h-9 w-9 items-center justify-center"
                title="Открыть на площадке"
                aria-label="Открыть на площадке"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
              </ProductLink>
            </Button>
          </div>
        </CardContent>
      </Card>

      {priceHistory.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>История цен</SectionLabel>
              {!isTracked && <span className="pg-caption">собирается автоматически</span>}
            </div>
            <PriceHistoryChart history={priceHistory} initialPrice={product.price} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
