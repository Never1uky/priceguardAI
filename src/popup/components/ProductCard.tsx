import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PriceHistoryChart } from '@/popup/components/PriceHistoryChart';
import { formatDate, formatPrice } from '@/lib/utils';
import { MARKETPLACE_LABELS, marketplaceBadgeVariant } from '@/utils/marketplace';
import type { PricePoint, Product } from '@/types/product';
import { ProductLink } from '@/popup/components/ProductLink';
import { Bell, ExternalLink, Shield } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  isTracked: boolean;
  isLoading: boolean;
  priceHistory: PricePoint[];
  onTrack: () => void;
  onUntrack: () => void;
}

const marketplaceLabels = MARKETPLACE_LABELS;

export function ProductCard({
  product,
  isTracked,
  isLoading,
  priceHistory,
  onTrack,
  onUntrack,
}: ProductCardProps) {
  return (
    <Card className="overflow-hidden border-primary/20">
      <CardHeader className="space-y-3 bg-gradient-to-br from-primary/10 to-transparent pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Текущий товар</CardTitle>
              <CardDescription className="text-xs">
                Обновлено {formatDate(product.scrapedAt)}
              </CardDescription>
            </div>
          </div>
          <Badge variant={marketplaceBadgeVariant(product.marketplace)}>{marketplaceLabels[product.marketplace]}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        <div className="flex gap-3">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="h-16 w-16 shrink-0 rounded-lg border object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
              Нет фото
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{product.title}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <p className="text-lg font-bold text-primary">{formatPrice(product.price)}</p>
              {product.oldPrice && product.oldPrice > product.price && (
                <p className="text-sm text-muted-foreground line-through">
                  {formatPrice(product.oldPrice)}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Артикул: {product.article}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {isTracked ? (
            <Button variant="secondary" className="flex-1" onClick={onUntrack} disabled={isLoading}>
              <Bell className="h-4 w-4" />
              Удалить из отслеживаемых
            </Button>
          ) : (
            <Button className="flex-1" onClick={onTrack} disabled={isLoading}>
              <Bell className="h-4 w-4" />
              Отслеживать товар
            </Button>
          )}
          <Button variant="outline" size="icon" asChild>
            <ProductLink
              url={product.url}
              marketplace={product.marketplace}
              className="inline-flex h-9 w-9 items-center justify-center"
            >
              <ExternalLink className="h-4 w-4" />
            </ProductLink>
          </Button>
        </div>

        {isTracked && priceHistory.length > 0 && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium">История цен</p>
            <PriceHistoryChart history={priceHistory} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
