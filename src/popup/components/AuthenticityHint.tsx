import { isAuthenticityWarning } from '@/types/authenticity';
import type { ProductAuthenticity } from '@/types/authenticity';
import type { Marketplace } from '@/types/product';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

interface AuthenticityHintProps {
  marketplace: Marketplace;
  authenticity?: ProductAuthenticity;
}

export function AuthenticityHint({ marketplace, authenticity }: AuthenticityHintProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !isAuthenticityWarning(authenticity, marketplace)) return null;

  const message =
    authenticity?.label && authenticity.label !== 'Без метки «Оригинал»'
      ? authenticity.label
      : 'Возможно не оригинал';

  return (
    <div className="flex items-center gap-2 rounded-sm bg-warning/10 px-3 py-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 pg-hint text-warning">{message}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-sm p-0.5 text-warning/70 hover:bg-warning/10 hover:text-warning pg-transition"
        aria-label="Скрыть предупреждение"
        title="Скрыть"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
