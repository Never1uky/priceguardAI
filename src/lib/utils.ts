import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, currency = '₽'): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency === '₽' ? 'RUB' : currency,
    maximumFractionDigits: 0,
  }).format(price);
}

/** Подпись к цене со скидкой оплаты (Пэй / банки Ozon). */
export function paymentDiscountLabel(
  marketplace: 'wildberries' | 'ozon' | 'yandex_market' | string,
): string {
  if (marketplace === 'yandex_market') return 'с Пэй';
  if (marketplace === 'ozon') return 'с банками';
  return 'со скидкой оплаты';
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
