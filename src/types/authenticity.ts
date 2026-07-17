import type { Marketplace } from '@/types/product';

/** Результат проверки метки «Оригинал» на карточке WB / Ozon */
export type AuthenticityStatus = 'original' | 'not_original' | 'unknown';

export interface ProductAuthenticity {
  status: AuthenticityStatus;
  /** Короткая подпись для UI */
  label?: string;
  detectedAt: number;
}

export function isAuthenticityWarning(
  authenticity: ProductAuthenticity | undefined,
  _marketplace: Marketplace,
): boolean {
  if (!authenticity) return false;
  return authenticity.status === 'not_original';
}
