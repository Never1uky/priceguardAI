import { dismissToast, subscribeToasts, type ToastItem, type ToastType } from '@/popup/lib/toast';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

const toastStyles: Record<ToastType, string> = {
  error:
    'border-red-200 bg-red-50 text-red-900 shadow-red-100 dark:border-red-500/40 dark:bg-red-950/90 dark:text-red-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 shadow-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-950/90 dark:text-emerald-100',
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 shadow-amber-100 dark:border-amber-500/40 dark:bg-amber-950/90 dark:text-amber-100',
  info: 'border-slate-200 bg-white text-slate-900 shadow-slate-100 dark:border-slate-500/40 dark:bg-slate-900 dark:text-slate-100',
};

function ToastIcon({ type }: { type: ToastType }) {
  const className = 'mt-0.5 h-4 w-4 shrink-0';
  switch (type) {
    case 'success':
      return <CheckCircle2 className={className} />;
    case 'error':
      return <XCircle className={className} />;
    case 'warning':
      return <AlertCircle className={className} />;
    default:
      return <Info className={className} />;
  }
}

function ToastCard({ item }: { item: ToastItem }) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-lg transition-all ${toastStyles[item.type]}`}
    >
      <ToastIcon type={item.type} />
      <p className="min-w-0 flex-1 leading-snug">{item.message}</p>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
        aria-label="Закрыть"
        onClick={() => dismissToast(item.id)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Контейнер toast-уведомлений — монтируется один раз в корне popup */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[9999] flex flex-col items-center gap-2 px-3">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
