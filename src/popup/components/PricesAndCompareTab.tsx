import { cn } from '@/lib/utils';
import { CompareTab } from '@/popup/components/CompareTab';
import { CurrentPriceTab } from '@/popup/components/CurrentPriceTab';
import type { PricePoint, Product } from '@/types/product';
import { Scale, Tag } from 'lucide-react';

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
  onRefresh: () => void;
  onCompare: () => void;
  isComparePending?: boolean;
  fullAnalysisBusy?: boolean;
}

const SUB_VIEWS: { id: PriceSubView; label: string; icon: typeof Tag }[] = [
  { id: 'current', label: 'Текущая цена', icon: Tag },
  { id: 'compare', label: 'Сравнение', icon: Scale },
];

export function PricesAndCompareTab({
  isTabActive,
  subView,
  onSubViewChange,
  ...priceProps
}: PricesAndCompareTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-md bg-muted/60 p-1" role="tablist" aria-label="Раздел цены">
        {SUB_VIEWS.map(({ id, label, icon: Icon }) => {
          const active = subView === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSubViewChange(id)}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 pg-transition pg-body',
                active
                  ? 'bg-background text-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {subView === 'current' ? (
        <CurrentPriceTab {...priceProps} />
      ) : (
        <CompareTab isActive={isTabActive && subView === 'compare'} />
      )}
    </div>
  );
}
