import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { CompareProductDetail } from '@/popup/components/CompareProductDetail';
import { useCompareTab } from '@/popup/hooks/useCompareTab';
import { PackageSearch } from 'lucide-react';

interface CompareTabProps {
  isActive: boolean;
  /** When set, only show detail (used if ever embedded). Prefer MyProductsTab. */
  detailOnly?: boolean;
  onGoToMyProducts?: () => void;
}

/**
 * Legacy sub-tab under «Цены». Redirects users to «Мои товары».
 * Detail-only mode kept for deep embeds.
 */
export function CompareTab({ isActive, detailOnly = false, onGoToMyProducts }: CompareTabProps) {
  const api = useCompareTab(isActive);

  if (detailOnly && api.selectedProduct) {
    return <CompareProductDetail api={api} />;
  }

  return (
    <EmptyState
      icon={PackageSearch}
      title="Сравнение переехало"
      description="Все товары для сравнения и оповещений теперь во вкладке «Мои товары». Откройте карточку — увидите таблицу цен, «Обновить данные» и «Найти заново»."
    >
      {onGoToMyProducts && (
        <Button size="sm" className="mt-3" onClick={onGoToMyProducts}>
          Открыть «Мои товары»
        </Button>
      )}
    </EmptyState>
  );
}
