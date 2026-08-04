import { resolveProductArticle } from '@/lib/price-identity';
import type { Marketplace } from '@/types/product';

/** Стабильный product_id для tracked_products / tombstone (article > id). */
export function cloudTrackedProductKey(item: {
  article?: string;
  id: string;
  marketplace?: Marketplace;
  url?: string;
}): string {
  if (item.marketplace) {
    const article = resolveProductArticle({
      marketplace: item.marketplace,
      article: item.article,
      url: item.url,
      id: item.id,
    });
    if (article) return article;
  }
  return (item.article && item.article.trim()) || item.id;
}

export function cloudTrackedRowKey(marketplace: Marketplace, productId: string): string {
  return `${marketplace}:${productId}`;
}
