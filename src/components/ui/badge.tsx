import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-medium pg-transition',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
        success: 'border-transparent bg-success/10 text-success',
        warning: 'border-transparent bg-warning/10 text-warning',
        danger: 'border-transparent bg-destructive/10 text-destructive',
        purple: 'border-transparent bg-purple/10 text-purple',
        wildberries: 'border-transparent bg-purple/15 text-purple',
        ozon: 'border-transparent bg-info/15 text-info',
        yandex: 'border-transparent bg-warning/15 text-warning',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
