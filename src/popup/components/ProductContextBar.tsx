import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/utils';
import type { ProductDataSource } from '@/popup/hooks/useLiveProduct';
import type { Product } from '@/types/product';
import { MARKETPLACE_SHORT_LABELS, marketplaceBadgeVariant } from '@/utils/marketplace';
import { HardDrive, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ProductContextBarProps {
  product: Product | null;
  dataSource: ProductDataSource;
  isLoading?: boolean;
}

export function ProductContextBar({ product, dataSource, isLoading }: ProductContextBarProps) {
  const [showCachedHint, setShowCachedHint] = useState(false);

  useEffect(() => {
    if (isLoading || dataSource === 'loading') return;
    if (dataSource === 'cached' && product?.id) {
      setShowCachedHint(true);
      const timer = window.setTimeout(() => setShowCachedHint(false), 5000);
      return () => window.clearTimeout(timer);
    }
    setShowCachedHint(false);
  }, [dataSource, product?.id, isLoading]);

  if (!product && dataSource === 'none' && !isLoading) {
    return (
      <div className="border-t border-border px-4 py-3">
        <p className="pg-hint text-center text-foreground/70">
          Откройте любой товар на Wildberries. Сравнение появится само.
        </p>
      </div>
    );
  }

  const showLoading = isLoading || dataSource === 'loading';

  return (
    <div className="border-t border-border bg-muted/30 px-4 py-3">
      {product ? (
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge
                variant={marketplaceBadgeVariant(product.marketplace)}
                className="shrink-0"
              >
                {MARKETPLACE_SHORT_LABELS[product.marketplace]}
              </Badge>
              {showLoading && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Обновление
                </span>
              )}
              {!showLoading && showCachedHint && (
                <span className="inline-flex items-center gap-1 text-[10px] text-warning">
                  <HardDrive className="h-3 w-3" />
                  Кэш
                </span>
              )}
              {!showLoading && !showCachedHint && product.article && (
                <span className="truncate text-[11px] text-foreground/70">арт. {product.article}</span>
              )}
            </div>
            <p
              className="line-clamp-2 text-[12px] font-medium leading-snug text-foreground"
              title={product.title}
            >
              {product.title}
            </p>
          </div>
          {product.price > 0 && (
            <div className="shrink-0 text-right">
              <p className="text-[15px] font-semibold tabular-nums leading-none text-primary">
                {formatPrice(product.price)}
              </p>
              <p className="mt-1 text-[11px] text-foreground/65">
                {dataSource === 'current_tab'
                  ? 'с вкладки'
                  : dataSource === 'cached'
                    ? 'из кэша'
                    : 'сейчас'}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <p className="pg-hint">Загрузка товара…</p>
        </div>
      )}
    </div>
  );
}
