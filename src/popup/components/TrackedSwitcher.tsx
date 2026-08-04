import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { formatPrice } from '@/lib/utils';
import type { TrackedProduct } from '@/types/product';
import { ChevronLeft, ChevronRight, Info, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface TrackedSwitcherProps {
  products: TrackedProduct[];
  selectedId: string | null;
  onSelect: (product: TrackedProduct) => void;
  onRemove?: (productId: string) => void | Promise<void>;
  removingId?: string | null;
}

export function TrackedSwitcher({
  products,
  selectedId,
  onSelect,
  onRemove,
  removingId,
}: TrackedSwitcherProps) {
  const [showInfo, setShowInfo] = useState(false);

  if (products.length === 0) return null;

  const currentIndex = selectedId ? products.findIndex((product) => product.id === selectedId) : 0;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const current = products[safeIndex];
  const isRemoving = removingId === current.id;

  const goPrev = () => {
    const nextIndex = safeIndex <= 0 ? products.length - 1 : safeIndex - 1;
    onSelect(products[nextIndex]);
    setShowInfo(false);
  };

  const goNext = () => {
    const nextIndex = safeIndex >= products.length - 1 ? 0 : safeIndex + 1;
    onSelect(products[nextIndex]);
    setShowInfo(false);
  };

  return (
    <div className="space-y-1.5">
      <Surface variant="subtle" padding="sm" className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={goPrev} disabled={products.length <= 1} title="Предыдущий товар" aria-label="Предыдущий товар">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>

        <div className="min-w-0 flex-1 px-1 text-center">
          <p className="pg-caption text-muted-foreground">Товар {safeIndex + 1} из {products.length}</p>
          <p className="truncate pg-body font-medium">{current.title}</p>
          <p className="pg-caption font-semibold text-primary">{formatPrice(current.price)}</p>
        </div>

        <Button variant={showInfo ? 'secondary' : 'ghost'} size="icon-sm" className="shrink-0" onClick={() => setShowInfo((v) => !v)} title="Информация" aria-label="Информация о товаре" aria-pressed={showInfo}>
          <Info className="h-3.5 w-3.5" aria-hidden />
        </Button>

        {onRemove && (
          <Button variant="ghost" size="icon-sm" className="shrink-0 text-destructive hover:bg-destructive/10" disabled={isRemoving} onClick={() => void onRemove(current.id)} title="Удалить из отслеживаемых" aria-label="Удалить из отслеживаемых">
            {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
          </Button>
        )}

        <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={goNext} disabled={products.length <= 1} title="Следующий товар" aria-label="Следующий товар">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </Surface>

      {showInfo && (
        <Surface variant="subtle" padding="sm" className="pg-caption">
          <p><span className="text-muted-foreground">Артикул:</span> <span className="font-medium">{current.article || '—'}</span></p>
          <p className="mt-1"><span className="text-muted-foreground">Минимум:</span> <span className="font-medium text-green-600 dark:text-green-400">{formatPrice(current.lowestPrice)}</span></p>
        </Surface>
      )}
    </div>
  );
}