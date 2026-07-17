import { normalizeProductTabUrl } from '@/lib/reviews/tab-resolver';
import type { Marketplace } from '@/types/product';
import { detectMarketplace } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';

export interface ReviewCacheProductRef {
  url: string;
  marketplace?: string;
  article?: string;
  id?: string;
}

/** Стабильный ключ кэша — один товар = одна запись, независимо от product.id в памяти. */
export function getReviewCacheKey(ref: ReviewCacheProductRef): string {
  const marketplace =
    (ref.marketplace as Marketplace | undefined) ??
    (ref.url ? detectMarketplace(ref.url) ?? undefined : undefined);

  if (marketplace && ref.article) {
    return `mp:${marketplace}:${ref.article}`;
  }

  if (ref.url?.startsWith('http')) {
    const canonical = toCanonicalProductUrl(ref.url, marketplace ?? null);
    return `url:${normalizeProductTabUrl(canonical)}`;
  }

  if (ref.id) {
    return `id:${ref.id}`;
  }
  return 'unknown';
}

export function cacheKeyMatchesProduct(
  cacheKey: string,
  ref: ReviewCacheProductRef,
): boolean {
  return cacheKey === getReviewCacheKey(ref);
}
