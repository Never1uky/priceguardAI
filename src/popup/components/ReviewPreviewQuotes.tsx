import { Badge } from '@/components/ui/badge';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import type { ReviewPreviewItem } from '@/lib/reviews/collect-reviews';
import { Star } from 'lucide-react';

interface ReviewPreviewQuotesProps {
  items: ReviewPreviewItem[];
  totalFound: number;
  isLoading?: boolean;
}

export function ReviewPreviewQuotes({ items, totalFound, isLoading }: ReviewPreviewQuotesProps) {
  if (isLoading) {
    return (
      <Surface variant="subtle" padding="sm" className="text-center">
        <p className="pg-hint">Загружаем превью отзывов…</p>
      </Surface>
    );
  }

  if (!items.length) return null;

  return (
    <Surface variant="raised" padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Превью отзывов</SectionLabel>
        {totalFound > 0 && <Badge variant="outline">найдено {totalFound}</Badge>}
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="rounded-sm bg-muted/40 px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="pg-caption">{item.author ?? 'Покупатель'}</span>
              {item.rating != null && item.rating > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-warning">
                  <Star className="h-3 w-3 fill-warning text-warning" strokeWidth={1.75} />
                  {item.rating.toFixed(0)}
                </span>
              )}
            </div>
            <p className="line-clamp-3 pg-hint text-foreground/90">«{item.text}»</p>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
