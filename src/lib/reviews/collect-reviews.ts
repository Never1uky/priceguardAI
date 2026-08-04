/**
 * Единая точка сбора отзывов для PREVIEW_REVIEWS / FULL_PRODUCT_ANALYSIS.
 * Не вызывать из compare / ENSURE_COMPARE / Current price / add-to-my-products.
 */

import { scrapeReviewsFromActiveTab, scrapeReviewsFromCurrentActiveTab } from '@/lib/reviews/scrape-active-tab';
import { scrapeReviewsViaHiddenTab } from '@/lib/reviews/scrape-via-tab';
import { getRunningCompareProductId } from '@/lib/compare-jobs';
import type { WbReviewItem } from '@/lib/reviews/wb-feedbacks';
import type { Marketplace } from '@/types/product';
import type { ReviewFilter } from '@/types/review-analysis';
import { MIN_REVIEWS_FOR_ANALYSIS } from '@/types/review-analysis';
import { extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { fetchWildberriesReviews } from '@/utils/parsers/wb-api';

export type ReviewCollectSource = 'active_tab' | 'current_page' | 'wb_api' | 'hidden_tab' | 'none';

/** Цитата для превью перед AI-анализом */
export interface ReviewPreviewItem {
  text: string;
  rating?: number;
  author?: string;
  /** Локализованная дата (из WB timestamp), только UI */
  dateLabel?: string;
  /** Характеристики варианта (цвет/размер) — chips; пока обычно пусто */
  attrs?: string[];
}

export interface CollectedReviews {
  reviews: string[];
  /** Оценки 1–5, если доступны из API */
  reviewRatings?: Array<number | undefined>;
  previewItems: ReviewPreviewItem[];
  totalFound: number;
  source: ReviewCollectSource;
  /** Меньше MIN_REVIEWS_FOR_ANALYSIS — предложить ручной поиск */
  insufficient: boolean;
}

export interface CollectReviewsOptions {
  productUrl: string;
  marketplace: Marketplace;
  article?: string;
  filter?: ReviewFilter;
  preferActiveTab?: boolean;
  preferCurrentPage?: boolean;
  /** Не собирать отзывы, пока идёт фоновое сравнение цен */
  skipWhileCompareRunning?: boolean;
  /** Превью в popup: без hidden tab, без навигации на странице */
  previewOnly?: boolean;
  /** Разрешить переходы/клики по вкладке «Отзывы» (только полный анализ) */
  allowNavigation?: boolean;
}

function formatReviewDateLabel(timestamp?: number): string | undefined {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(timestamp));
  } catch {
    return undefined;
  }
}

function toPreviewItems(reviews: string[], wbItems?: WbReviewItem[]): ReviewPreviewItem[] {
  if (wbItems?.length) {
    return wbItems.slice(0, 3).map((r) => ({
      text: r.text.slice(0, 280),
      rating: r.rating,
      author: r.author ?? 'Покупатель',
      dateLabel: formatReviewDateLabel(r.timestamp),
    }));
  }

  return reviews.slice(0, 3).map((text, i) => ({
    text: text.slice(0, 280),
    author: `Отзыв ${i + 1}`,
  }));
}

/**
 * Собирает тексты отзывов из всех доступных источников.
 * WB feedbacks API — только здесь (SW), не из content script на карточке.
 */
export async function collectReviewsForProduct(
  options: CollectReviewsOptions,
): Promise<CollectedReviews> {
  const {
    productUrl,
    marketplace,
    article,
    filter = 'all',
    preferActiveTab = true,
    preferCurrentPage = true,
    skipWhileCompareRunning = true,
    previewOnly = false,
    allowNavigation = false,
  } = options;

  if (skipWhileCompareRunning && (await getRunningCompareProductId())) {
    return {
      reviews: [],
      previewItems: [],
      totalFound: 0,
      source: 'none',
      insufficient: false,
    };
  }

  const canonicalUrl = toCanonicalProductUrl(productUrl, marketplace);
  const resolvedArticle =
    article?.trim() || extractArticle(canonicalUrl, marketplace) || undefined;

  let reviews: string[] = [];
  let reviewRatings: Array<number | undefined> | undefined;
  let wbItems: WbReviewItem[] | undefined;
  let totalFound = 0;
  let source: ReviewCollectSource = 'none';

  // 1) WB API из SW (credentials omit) — до DOM на странице, без CORS-шума
  if (marketplace === 'wildberries' && resolvedArticle) {
    try {
      const fromApi = await fetchWildberriesReviews(resolvedArticle, 50);
      if (fromApi.length > 0) {
        wbItems = fromApi;
        reviews = fromApi.map((r) => r.text);
        reviewRatings = fromApi.map((r) => r.rating);
        totalFound = fromApi.length;
        source = 'wb_api';
        if (reviews.length >= MIN_REVIEWS_FOR_ANALYSIS) {
          return {
            reviews,
            reviewRatings,
            previewItems: toPreviewItems(reviews, wbItems),
            totalFound,
            source,
            insufficient: false,
          };
        }
      }
    } catch (error) {
      console.warn('[PriceGuard] fetchWildberriesReviews:', error);
    }
  }

  if (preferCurrentPage && reviews.length < MIN_REVIEWS_FOR_ANALYSIS) {
    try {
      const fromCurrent = await scrapeReviewsFromCurrentActiveTab(filter, allowNavigation);
      if (fromCurrent && fromCurrent.reviews.length > 0) {
        if (fromCurrent.reviews.length >= MIN_REVIEWS_FOR_ANALYSIS) {
          return {
            reviews: fromCurrent.reviews,
            previewItems: toPreviewItems(fromCurrent.reviews),
            totalFound: fromCurrent.totalFound,
            source: 'current_page',
            insufficient: false,
          };
        }
        if (fromCurrent.reviews.length > reviews.length) {
          reviews = fromCurrent.reviews;
          totalFound = fromCurrent.totalFound;
          source = 'current_page';
        }
      }
    } catch (error) {
      console.warn('[PriceGuard] scrapeReviewsFromCurrentActiveTab:', error);
    }
  }

  if (preferActiveTab && reviews.length < MIN_REVIEWS_FOR_ANALYSIS) {
    try {
      const fromTab = await scrapeReviewsFromActiveTab(canonicalUrl, filter, allowNavigation);
      if (fromTab && fromTab.reviews.length > reviews.length) {
        reviews = fromTab.reviews;
        totalFound = fromTab.totalFound;
        source = 'active_tab';
      }
    } catch (error) {
      console.warn('[PriceGuard] scrapeReviewsFromActiveTab:', error);
    }
  }

  if (!previewOnly && reviews.length < MIN_REVIEWS_FOR_ANALYSIS) {
    try {
      const fromHidden = await scrapeReviewsViaHiddenTab(canonicalUrl, marketplace, filter);
      if (fromHidden.reviews.length > reviews.length) {
        reviews = fromHidden.reviews;
        totalFound = Math.max(totalFound, fromHidden.totalFound);
        // WB path = same feedbacks API; YM = hidden browser tab
        source = marketplace === 'yandex_market' ? 'hidden_tab' : 'wb_api';
      }
    } catch (error) {
      console.warn('[PriceGuard] scrapeReviewsViaHiddenTab:', error);
    }
  }

  return {
    reviews,
    reviewRatings: reviewRatings?.length === reviews.length ? reviewRatings : wbItems?.map((r) => r.rating),
    previewItems: toPreviewItems(reviews, wbItems),
    totalFound,
    source,
    insufficient: reviews.length > 0 && reviews.length < MIN_REVIEWS_FOR_ANALYSIS,
  };
}
