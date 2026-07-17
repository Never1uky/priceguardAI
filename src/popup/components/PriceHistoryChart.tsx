import { formatDate, formatPrice } from '@/lib/utils';
import type { PricePoint } from '@/types/product';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface PriceHistoryChartProps {
  history: PricePoint[];
  initialPrice?: number;
}

export function PriceHistoryChart({ history, initialPrice }: PriceHistoryChartProps) {
  if (history.length === 0) {
    return (
      <p className="pg-hint">История цен появится после первого изменения.</p>
    );
  }

  const prices = history.map((point) => point.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const range = maxPrice - minPrice || 1;
  const width = 320;
  const height = 108;
  const paddingX = 8;
  const paddingY = 12;

  const points = history.map((point, index) => {
    const x = paddingX + (index / Math.max(history.length - 1, 1)) * (width - paddingX * 2);
    const y = height - paddingY - ((point.price - minPrice) / range) * (height - paddingY * 2);
    return { x, y, point };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath =
    points.length > 0
      ? `M ${points[0].x},${height - paddingY} L ${points.map((p) => `${p.x},${p.y}`).join(' L ')} L ${points[points.length - 1].x},${height - paddingY} Z`
      : '';

  const firstPrice = history[0]?.price ?? 0;
  const lastPrice = history[history.length - 1]?.price ?? 0;
  const baseline = initialPrice ?? firstPrice;
  const totalDiff = lastPrice - baseline;
  const isCheaper = totalDiff < 0;
  const showDots = history.length <= 24;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-sm bg-muted/50 px-2.5 py-2">
          <p className="pg-caption">Минимум</p>
          <p className="pg-subtitle mt-0.5 tabular-nums text-success">{formatPrice(minPrice)}</p>
        </div>
        <div className="rounded-sm bg-muted/50 px-2.5 py-2">
          <p className="pg-caption">Среднее</p>
          <p className="pg-subtitle mt-0.5 tabular-nums">{formatPrice(avgPrice)}</p>
        </div>
        <div className="rounded-sm bg-muted/50 px-2.5 py-2">
          <p className="pg-caption">Максимум</p>
          <p className="pg-subtitle mt-0.5 tabular-nums text-destructive">{formatPrice(maxPrice)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="pg-caption">{history.length} записей</span>
        <span
          className={`flex items-center gap-1 text-[11px] font-medium ${
            isCheaper ? 'text-success' : totalDiff > 0 ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {totalDiff < 0 ? (
            <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : totalDiff > 0 ? (
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : null}
          {totalDiff === 0
            ? 'без изменений'
            : `${totalDiff > 0 ? '+' : ''}${formatPrice(totalDiff)}`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible rounded-sm bg-muted/30"
        role="img"
        aria-label="График истории цен"
      >
        <defs>
          <linearGradient id="pg-price-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {areaPath && <path d={areaPath} fill="url(#pg-price-fill)" />}
        <polyline
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline}
        />
        {showDots &&
          points.map(({ x, y, point }) => (
            <circle
              key={point.timestamp}
              cx={x}
              cy={y}
              r="2.5"
              fill="hsl(var(--background))"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
            />
          ))}
      </svg>

      <div className="max-h-28 space-y-1.5 overflow-y-auto">
        {[...history]
          .reverse()
          .slice(0, 6)
          .map((point) => (
            <div
              key={point.timestamp}
              className="flex items-center justify-between pg-hint"
            >
              <span>{formatDate(point.timestamp)}</span>
              <span className="font-medium tabular-nums text-foreground">
                {formatPrice(point.price)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
