/**
 * Сбор отзывов без открытия вкладок: WB API (SW) + фоновая вкладка Я.Маркет.
 * Не использовать из compare-jobs.
 */
import { getRunningCompareProductId } from '@/lib/compare-jobs';
import { scrapeYandexReviewsViaHiddenTab } from '@/lib/reviews/ym-reviews-tab';
import type { Marketplace } from '@/types/product';
import type { ReviewFilter } from '@/types/review-analysis';
import { extractArticle } from '@/utils/marketplace';
import { fetchWildberriesReviews } from '@/utils/parsers/wb-api';
import { toCanonicalProductUrl } from '@/utils/product-url';

export interface HiddenReviewsResult {
  reviews: string[];
  totalFound: number;
}

/**
 * Загрузка отзывов через API / фоновую вкладку.
 */
export async function scrapeReviewsViaHiddenTab(
  productUrl: string,
  marketplace: Marketplace,
  filter: ReviewFilter = 'all',
): Promise<HiddenReviewsResult> {
  if (await getRunningCompareProductId()) {
    return { reviews: [], totalFound: 0 };
  }

  if (marketplace === 'wildberries') {
    const canonical = toCanonicalProductUrl(productUrl, marketplace);
    const article = extractArticle(canonical, 'wildberries');
    if (article) {
      try {
        const items = await fetchWildberriesReviews(article, 50);
        if (items.length > 0) {
          return {
            reviews: items.map((r) => r.text),
            totalFound: items.length,
          };
        }
      } catch (error) {
        console.warn('[PriceGuard] WB reviews API:', error);
      }
    }
  }

  if (marketplace === 'yandex_market') {
    return scrapeYandexReviewsViaHiddenTab(productUrl, filter);
  }

  return { reviews: [], totalFound: 0 };
}
