/**
 * Лёгкий toast без внешних зависимостей — для popup расширения.
 */

export type ToastType = 'error' | 'success' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

type Listener = (toasts: ToastItem[]) => void;

const listeners = new Set<Listener>();
let toasts: ToastItem[] = [];

function emit(): void {
  const snapshot = [...toasts];
  listeners.forEach((listener) => listener(snapshot));
}

function scheduleDismiss(id: string, durationMs: number): void {
  window.setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

export function toast(message: string, type: ToastType = 'info', durationMs = 4500): void {
  const id = crypto.randomUUID();
  toasts = [...toasts.slice(-4), { id, message, type }];
  emit();
  scheduleDismiss(id, durationMs);
}

export function toastError(message: string): void {
  toast(message, 'error', 5500);
  void import('@/lib/support-report').then((m) =>
    m.reportExtensionError(message, 'toastError'),
  );
}

export function toastSuccess(message: string): void {
  toast(message, 'success', 3500);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
}
