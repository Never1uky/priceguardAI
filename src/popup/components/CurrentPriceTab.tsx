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
import { Bell, BellOff, ExternalLink, RefreshCw, Scale, TrendingDown } from 'lucide-react';

interface CurrentPriceTabProps {
  product: Product | null;
  isTracked: boolean;
  isLoading: boolean;
  priceHistory: PricePoint[];
  error: string | null;
  onTrack: () => void;
  onUntrack: () => void;
  onRefresh: () => void;
  onCompare: () => void;
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
  onRefresh,
  onCompare,
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
            <ProductImage product={product} className="h-20 w-20 rounded-sm" />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-3 pg-title">{product.title}</h2>
              <p className="pg-caption mt-1.5">Арт. {product.article}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
              {formatPrice(product.basePrice ?? product.price)}
            </span>
            {product.oldPrice && product.oldPrice > (product.basePrice ?? product.price) && (
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

          <div className="grid grid-cols-2 gap-2">
            {isTracked ? (
              <Button variant="secondary" onClick={onUntrack} disabled={isLoading}>
                <BellOff className="h-4 w-4" strokeWidth={1.75} />
                Убрать
              </Button>
            ) : (
              <Button onClick={onTrack} disabled={isLoading}>
                <Bell className="h-4 w-4" strokeWidth={1.75} />
                Отслеживать
              </Button>
            )}
            <Button
              variant="outline"
              onClick={onCompare}
              disabled={isLoading || isComparePending || fullAnalysisBusy}
            >
              <Scale
                className={`h-4 w-4 ${isComparePending ? 'animate-pulse' : ''}`}
                strokeWidth={1.75}
              />
              {isComparePending ? 'Сравниваем…' : 'Сравнить'}
            </Button>
          </div>

          {!isTracked && (
            <p className="pg-caption">
              При отслеживании вы получите уведомление, если цена упадёт на 1% или более 100 ₽
            </p>
          )}

          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={onRefresh} title="Обновить">
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                strokeWidth={1.75}
              />
            </Button>
            <Button variant="ghost" size="icon-sm" asChild>
              <ProductLink
                url={product.url}
                marketplace={product.marketplace}
                className="inline-flex h-8 w-8 items-center justify-center"
                title="Открыть на маркетплейсе"
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
