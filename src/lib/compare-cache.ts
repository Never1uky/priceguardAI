import { isOfferWithPrice, offersFromCompareProduct } from '@/lib/compare-offers';
import type { CompareProduct, ComparisonMarketplace } from '@/types/comparison';

/** Как фоновые проверки цен — 6 часов */
export const COMPARE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export function hasStoredCompareOffers(
  product: CompareProduct,
  marketplaces?: ComparisonMarketplace[],
): boolean {
  return offersFromCompareProduct(product, { marketplaces }).some((o) => isOfferWithPrice(o));
}

export function isCompareCacheFresh(product: CompareProduct): boolean {
  if (!product.comparedAt) return false;
  return Date.now() - product.comparedAt < COMPARE_CACHE_TTL_MS;
}

export function shouldRunCompare(
  product: CompareProduct,
  force = false,
  marketplaces?: ComparisonMarketplace[],
): boolean {
  if (force) return true;
  if (!hasStoredCompareOffers(product, marketplaces)) return true;
  return !isCompareCacheFresh(product);
}

export function formatComparedAt(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
