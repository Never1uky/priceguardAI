/**
 * Presentational review card for Reviews tab preview.
 * No AI calls — insight tone derived from rating only.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReviewPreviewItem } from '@/lib/reviews/collect-reviews';
import { Star } from 'lucide-react';

function authorInitial(author?: string): string {
  const name = (author ?? 'Покупатель').trim();
  const ch = name.charAt(0);
  return ch ? ch.toUpperCase() : 'П';
}

function normalizeHint(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function filterAttrsAgainstProduct(attrs: string[], productHints?: string[]): string[] {
  if (!attrs.length) return [];
  if (!productHints?.length) return attrs;
  const hints = productHints.map(normalizeHint).filter(Boolean);
  return attrs.filter((attr) => {
    const n = normalizeHint(attr);
    if (!n) return false;
    return !hints.some((h) => h.includes(n) || n.includes(h));
  });
}

function sentimentFromRating(
  rating?: number,
): 'positive' | 'neutral' | 'negative' | 'unavailable' {
  if (rating == null || rating < 1) return 'unavailable';
  if (rating >= 4) return 'positive';
  if (rating >= 3) return 'neutral';
  return 'negative';
}

function snippetFromText(text: string, max = 96): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function ReviewCardHeader({
  author,
  dateLabel,
  rating,
}: {
  author?: string;
  dateLabel?: string;
  rating?: number;
}) {
  const name = author?.trim() || 'Покупатель';
  return (
    <header className="flex items-center gap-3">
      <div
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary"
      >
        {authorInitial(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate pg-body font-semibold text-foreground">{name}</span>
          {dateLabel ? (
            <>
              <span className="shrink-0 text-muted-foreground/50" aria-hidden>
                ·
              </span>
              <time className="shrink-0 pg-caption text-muted-foreground">{dateLabel}</time>
            </>
          ) : null}
        </div>
      </div>
      {rating != null && rating > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-warning">
          <Star className="h-3.5 w-3.5 fill-warning text-warning" strokeWidth={1.75} />
          {rating.toFixed(0)}
        </span>
      ) : null}
    </header>
  );
}

function ReviewAttrChips({
  attrs,
  productHints,
}: {
  attrs: string[];
  productHints?: string[];
}) {
  const visible = filterAttrsAgainstProduct(attrs, productHints);
  if (!visible.length) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {visible.map((attr) => (
        <li key={attr}>
          <Badge variant="outline" className="rounded-full px-2.5">
            {attr}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ReviewBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [needsClamp, setNeedsClamp] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setNeedsClamp(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div className="space-y-1">
      <p
        ref={ref}
        className={cn(
          'pg-body text-[13px] leading-snug text-foreground',
          !expanded && 'line-clamp-3',
        )}
      >
        {text}
      </p>
      {needsClamp || expanded ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-0.5 text-[11px] font-medium text-primary hover:bg-transparent hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Свернуть' : 'Читать полностью'}
        </Button>
      ) : null}
    </div>
  );
}

function ReviewAiInsight({ rating, text }: { rating?: number; text: string }) {
  const tone = sentimentFromRating(rating);

  if (tone === 'unavailable') {
    return (
      <aside className="rounded-xl bg-muted/40 px-3 py-2">
        <p className="pg-caption text-muted-foreground">AI Insight недоступен</p>
      </aside>
    );
  }

  const label =
    tone === 'positive' ? 'Позитивный' : tone === 'neutral' ? 'Нейтральный' : 'Негативный';
  const toneClass =
    tone === 'positive'
      ? 'bg-success/10 text-success'
      : tone === 'neutral'
        ? 'bg-warning/10 text-warning'
        : 'bg-destructive/10 text-destructive';

  return (
    <aside className={cn('rounded-xl px-3 py-2', toneClass)}>
      <p className="pg-caption font-medium">{label}</p>
      <p className="mt-0.5 line-clamp-2 pg-hint opacity-90">{snippetFromText(text)}</p>
    </aside>
  );
}

export interface ReviewCardProps {
  item: ReviewPreviewItem;
  productHints?: string[];
}

export function ReviewCard({ item, productHints }: ReviewCardProps) {
  return (
    <article className="space-y-3 rounded-[20px] border border-border/60 bg-card p-4 shadow-soft">
      <ReviewCardHeader author={item.author} dateLabel={item.dateLabel} rating={item.rating} />
      <div className="h-px bg-border/60" role="separator" />
      {item.attrs?.length ? (
        <ReviewAttrChips attrs={item.attrs} productHints={productHints} />
      ) : null}
      <ReviewBody text={item.text} />
      <ReviewAiInsight rating={item.rating} text={item.text} />
    </article>
  );
}

export function ReviewListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-3" aria-busy="true" aria-label="Загружаем превью отзывов">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="h-28 animate-pulse rounded-[20px] bg-muted"
        />
      ))}
    </ul>
  );
}
