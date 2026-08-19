import { cn } from '@/lib/utils';
import { CompareTab } from '@/popup/components/CompareTab';
import { CurrentPriceTab } from '@/popup/components/CurrentPriceTab';
import type { PricePoint, Product } from '@/types/product';
import { Package, Tag } from 'lucide-react';
import type { KeyboardEvent } from 'react';

export type PriceSubView = 'current' | 'compare';

interface PricesAndCompareTabProps {
  isTabActive: boolean;
  subView: PriceSubView;
  onSubViewChange: (view: PriceSubView) => void;
  product: Product | null;
  isTracked: boolean;
  isLoading: boolean;
  priceHistory: PricePoint[];
  error: string | null;
  onTrack: () => void;
  onUntrack: () => void;
  onAddToMyProducts: () => void;
  isComparePending?: boolean;
  fullAnalysisBusy?: boolean;
  atMyProductsLimit?: boolean;
  myProductsLimit?: number;
  onOpenPremium?: () => void;
  onGoToMyProducts?: () => void;
  onOpenAuth?: () => void;
}

const SUB_VIEWS: { id: PriceSubView; label: string; icon: typeof Tag }[] = [
  { id: 'current', label: 'Текущая цена', icon: Tag },
  { id: 'compare', label: 'Мои товары', icon: Package },
];

export function PricesAndCompareTab({
  isTabActive,
  subView,
  onSubViewChange,
  onGoToMyProducts,
  ...priceProps
}: PricesAndCompareTabProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = SUB_VIEWS.map((v) => v.id);
    const currentIdx = ids.indexOf(subView);
    let nextIdx = currentIdx;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      nextIdx = (currentIdx + 1) % ids.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      nextIdx = (currentIdx - 1 + ids.length) % ids.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIdx = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIdx = ids.length - 1;
    } else {
      return;
    }

    onSubViewChange(ids[nextIdx]);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[nextIdx]?.focus();
  };

  return (
    <div className="space-y-3">
      <div
        className="flex gap-1 rounded-md bg-muted/60 p-1"
        role="tablist"
        aria-label="Раздел цены"
        onKeyDown={handleKeyDown}
      >
        {SUB_VIEWS.map(({ id, label, icon: Icon }) => {
          const active = subView === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (id === 'compare' && onGoToMyProducts) {
                  onGoToMyProducts();
                  return;
                }
                onSubViewChange(id);
              }}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 pg-transition pg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-background text-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {subView === 'current' ? (
        <CurrentPriceTab {...priceProps} />
      ) : (
        <CompareTab
          isActive={isTabActive && subView === 'compare'}
          onGoToMyProducts={onGoToMyProducts}
        />
      )}
    </div>
  );
}
