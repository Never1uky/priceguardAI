import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getCompareProducts } from '@/lib/comparison-storage';
import { getTrackedProducts } from '@/lib/storage';
import { formatPrice } from '@/lib/utils';
import { ProductImage } from '@/popup/components/ProductImage';
import type { CompareProduct } from '@/types/comparison';
import type { Marketplace, Product, TrackedProduct } from '@/types/product';
import { MARKETPLACE_SHORT_LABELS, marketplaceBadgeVariant } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface ReviewProductPickerProps {
  selectedId?: string | null;
  selectedUrl?: string | null;
  onSelect: (product: Product) => void;
}

type PickerItem = Product & { sourceLabel: 'Список' | 'Сравнение' };

function compareToProduct(c: CompareProduct): Product {
  const offer = c.sourceOffer ?? c.marketplaceOffers?.[c.sourceMarketplace];
  return {
    id: c.id,
    marketplace: c.sourceMarketplace as Marketplace,
    title: c.title,
    price: offer?.price ?? 0,
    currency: 'RUB',
    article: c.article ?? c.articlesByMarketplace?.[c.sourceMarketplace] ?? '',
    url: c.sourceUrl,
    imageUrl: offer?.imageUrl,
    scrapedAt: c.addedAt,
  };
}

function dedupeKey(p: Product): string {
  try {
    return toCanonicalProductUrl(p.url, p.marketplace) || `${p.marketplace}:${p.id}`;
  } catch {
    return `${p.marketplace}:${p.id}`;
  }
}

function buildPickerList(tracked: TrackedProduct[], compare: CompareProduct[]): PickerItem[] {
  const seen = new Set<string>();
  const items: PickerItem[] = [];

  for (const p of tracked) {
    const key = dedupeKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...p, sourceLabel: 'Список' });
  }

  for (const c of compare) {
    const product = compareToProduct(c);
    const key = dedupeKey(product);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...product, sourceLabel: 'Сравнение' });
  }

  return items;
}

export function ReviewProductPicker({
  selectedId,
  selectedUrl,
  onSelect,
}: ReviewProductPickerProps) {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [tracked, compare] = await Promise.all([
          getTrackedProducts(),
          getCompareProducts(),
        ]);
        if (cancelled) return;
        setItems(buildPickerList(tracked, compare));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="pg-hint">Загрузка товаров…</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="pg-body py-3 text-center text-muted-foreground">
        Добавьте товар во вкладку Список или Сравнение
      </p>
    );
  }

  return (
    <ScrollArea className="h-52 pr-1">
      <ul className="space-y-1.5 pr-1">
        {items.map((item) => {
          const itemKey = dedupeKey(item);
          const selectedUrlKey = selectedUrl
            ? (() => {
                try {
                  return toCanonicalProductUrl(selectedUrl, item.marketplace);
                } catch {
                  return selectedUrl;
                }
              })()
            : null;
          const selected =
            (selectedId != null && item.id === selectedId) ||
            (selectedUrlKey != null && (item.url === selectedUrl || itemKey === selectedUrlKey));

          return (
            <li key={`${item.sourceLabel}:${item.id}`}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left pg-transition ${
                  selected
                    ? 'bg-primary/15 ring-1 ring-primary/40'
                    : 'bg-muted/40 hover:bg-muted/70'
                }`}
              >
                <ProductImage product={item} className="h-10 w-10 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 pg-hint font-medium text-foreground">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant={marketplaceBadgeVariant(item.marketplace)} className="text-[9px]">
                      {MARKETPLACE_SHORT_LABELS[item.marketplace]}
                    </Badge>
                    <span className="pg-caption text-muted-foreground">{item.sourceLabel}</span>
                    {item.price > 0 && (
                      <span className="pg-caption text-foreground">{formatPrice(item.price)}</span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
