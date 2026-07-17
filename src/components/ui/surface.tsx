import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const surfaceVariants = cva('min-w-0 overflow-hidden pg-transition', {
  variants: {
    variant: {
      plain: 'bg-transparent',
      subtle: 'rounded-md bg-muted/50',
      raised: 'rounded-md bg-card shadow-soft',
      hero: 'rounded-lg bg-hero text-hero-foreground shadow-soft',
      glass: 'rounded-md pg-glass shadow-soft',
    },
    padding: {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-5',
    },
  },
  defaultVariants: {
    variant: 'raised',
    padding: 'md',
  },
});

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(surfaceVariants({ variant, padding }), className)}
      {...props}
    />
  ),
);
Surface.displayName = 'Surface';

export { Surface, surfaceVariants };
