import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md bg-muted/40 px-4 py-8 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} /> : null}
      <p className="pg-subtitle">{title}</p>
      {description ? <p className="pg-hint max-w-[280px]">{description}</p> : null}
      {children}
    </div>
  );
}
