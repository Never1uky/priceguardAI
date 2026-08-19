import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import type { ReviewPreviewItem } from '@/lib/reviews/collect-reviews';
import { ReviewCard, ReviewListSkeleton } from '@/popup/components/reviews/ReviewCard';
import { MessageSquareText } from 'lucide-react';

interface ReviewPreviewQuotesProps {
  items: ReviewPreviewItem[];
  totalFound: number;
  isLoading?: boolean;
  /** Title / specs for filtering duplicate attr chips */
  productHints?: string[];
  /** When true, show EmptyState instead of hiding the block */
  showEmpty?: boolean;
}

export function ReviewPreviewQuotes({
  items,
  totalFound,
  isLoading,
  productHints,
  showEmpty = true,
}: ReviewPreviewQuotesProps) {
  if (isLoading) {
    return (
      <Surface variant="raised" padding="md" className="space-y-3">
        <SectionLabel>Превью отзывов</SectionLabel>
        <ReviewListSkeleton />
      </Surface>
    );
  }

  if (!items.length) {
    if (!showEmpty) return null;
    return (
      <Surface variant="raised" padding="md" className="space-y-3">
        <SectionLabel>Превью отзывов</SectionLabel>
        <EmptyState
          icon={MessageSquareText}
          title="У этого товара пока нет отзывов"
          description="Разбор по отзывам недоступен. Можно сравнить цену на вкладке «Цены»."
          className="rounded-[20px] py-6"
        />
      </Surface>
    );
  }

  return (
    <Surface variant="raised" padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Превью отзывов</SectionLabel>
        {totalFound > 0 && <Badge variant="outline">найдено {totalFound}</Badge>}
      </div>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={`${item.author ?? 'r'}-${i}-${item.text.slice(0, 24)}`}>
            <ReviewCard item={item} productHints={productHints} />
          </li>
        ))}
      </ul>
    </Surface>
  );
}
