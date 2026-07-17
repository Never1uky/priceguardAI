import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium pg-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-soft hover:bg-primary/90 active:scale-[0.98]',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]',
        outline:
          'border border-border bg-card text-foreground hover:bg-muted/60 active:scale-[0.98]',
        ghost: 'text-foreground hover:bg-muted/70 active:scale-[0.98]',
        destructive:
          'bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90 active:scale-[0.98]',
        purple:
          'bg-purple text-purple-foreground shadow-soft hover:bg-purple/90 active:scale-[0.98]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-sm px-3 text-xs',
        lg: 'h-10 rounded-sm px-5 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
