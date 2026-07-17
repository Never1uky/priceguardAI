/**
 * Артикул → цель для отзывов. Только Wildberries (прямая ссылка по nmId).
 * Ozon/YM SERP убран — без зависаний на antibot.
 */

import type { ResolvedReviewTarget } from '@/lib/reviews/resolve-target';
import { buildWildberriesUrl } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';

export async function resolveArticleParallel(article: string): Promise<ResolvedReviewTarget[]> {
  const trimmed = article.trim();
  if (!trimmed || !/^\d{5,12}$/.test(trimmed)) return [];

  const url = buildWildberriesUrl(trimmed);
  return [
    {
      productTitle: 'Товар Wildberries',
      productUrl: toCanonicalProductUrl(url, 'wildberries'),
      marketplace: 'wildberries',
      article: trimmed,
      productId: `review_wildberries_${trimmed}`,
      resolvedVia: 'article',
    },
  ];
}
