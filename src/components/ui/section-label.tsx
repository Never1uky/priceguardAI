import * as React from 'react';

import { cn } from '@/lib/utils';

export function SectionLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('pg-section-label', className)} {...props}>
      {children}
    </p>
  );
}
