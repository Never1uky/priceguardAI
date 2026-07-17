import { cn } from '@/lib/utils';

interface ScoreRingProps {
  score: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

function scoreTone(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.8) return 'text-success';
  if (ratio >= 0.6) return 'text-primary';
  if (ratio >= 0.4) return 'text-warning';
  return 'text-destructive';
}

function scoreStroke(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.8) return 'stroke-success';
  if (ratio >= 0.6) return 'stroke-primary';
  if (ratio >= 0.4) return 'stroke-warning';
  return 'stroke-destructive';
}

export function ScoreRing({
  score,
  max = 10,
  size = 88,
  strokeWidth = 7,
  label = 'Качество',
  className,
}: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(max, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference * (1 - clamped / max);

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-muted"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={cn('pg-transition', scoreStroke(clamped, max))}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={progress}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-2xl font-semibold tabular-nums leading-none', scoreTone(clamped, max))}>
            {clamped}
          </span>
          <span className="pg-caption mt-0.5">/{max}</span>
        </div>
      </div>
      {label ? <span className="pg-caption">{label}</span> : null}
    </div>
  );
}
