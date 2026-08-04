import type { Marketplace } from '@/types/product';
import type { ReviewFilter } from '@/types/review-analysis';
import { queryFirst } from '@/utils/dom';

export interface ScrapedReview {
  text: string;
  rating?: number;
  hasPhoto?: boolean;
  timestamp?: number;
}

export interface ScrapeReviewsResult {
  reviews: ScrapedReview[];
  totalFound: number;
}

const NEGATIVE_WORDS = [
  'плох', 'брак', 'разочар', 'ужас', 'не рекоменд', 'сломал', 'дефект', 'вернул', 'обман', 'мусор',
];

const WB_REVIEW_SELECTORS = [
  '[class*="feedback__text"]',
  '[class*="feedback-text"]',
  '[class*="comment__text"]',
  '[class*="feedback__content"]',
  '[class*="feedbacks__item"] [class*="text"]',
  '[class*="product-feedbacks"] [class*="text"]',
  '[data-testid="feedback-text"]',
  '[data-testid="feedback-item"] [class*="text"]',
  '[data-link="commentsList"] [class*="text"]',
  '[itemprop="reviewBody"]',
  '[class*="reviewText"]',
  'article[class*="feedback"] p',
];

const YANDEX_REVIEW_SELECTORS = [
  '[data-auto="review-text"]',
  '[data-auto="reviewText"]',
  '[data-auto="review"] [data-auto="review-text"]',
  '[data-auto="review"]',
  '[data-zone-name="review"]',
  '[data-zone-name="reviewText"]',
  '[data-apiary-widget-name="@marketfront/Reviews"]',
  '[class*="ReviewText"]',
  '[class*="review-text"]',
  '[class*="ReviewItem"]',
  'div[data-review-id]',
  '[itemprop="reviewBody"]',
];

const OZON_REVIEW_SELECTORS = [
  '[data-widget="webListReviews"] [class*="review"]',
  '[data-widget="webReviewProduct"]',
  '[data-widget="webReview"]',
  '[data-widget="paginatedReviews"] [class*="text"]',
  '[class*="review-text"]',
  '[class*="ReviewText"]',
  '[itemprop="reviewBody"]',
  'div[data-review-uuid]',
];

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function inferRating(text: string): number {
  const lower = text.toLowerCase();
  if (NEGATIVE_WORDS.some((w) => lower.includes(w))) return 2;
  if (lower.includes('отличн') || lower.includes('супер') || lower.includes('рекоменд')) return 5;
  return 4;
}

function parseRatingFromElement(element: Element): number | undefined {
  const ratingEl = element.querySelector(
    '[data-auto="review-rating"], [itemprop="ratingValue"], [class*="rating"]',
  );
  const raw = ratingEl?.textContent?.trim() ?? element.getAttribute('data-rating');
  if (!raw) return undefined;
  const num = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(num) && num >= 1 && num <= 5 ? num : undefined;
}

function parseReviewElement(element: Element): ScrapedReview | null {
  const text = element.textContent?.trim();
  if (!text || text.length < 15 || text.length > 2000) return null;

  const hasPhoto = Boolean(
    element.querySelector('img') ??
      element.closest('[class*="review"]')?.querySelector('img'),
  );

  const dateAttr =
    element.getAttribute('data-date') ??
    element.querySelector('time')?.getAttribute('datetime');

  let timestamp: number | undefined;
  if (dateAttr) {
    const parsed = Date.parse(dateAttr);
    if (!Number.isNaN(parsed)) timestamp = parsed;
  }

  const explicitRating = parseRatingFromElement(element);

  return {
    text,
    rating: explicitRating ?? inferRating(text),
    hasPhoto,
    timestamp,
  };
}

function scrapeReviewsFromDom(selectors: string[]): ScrapedReview[] {
  const seen = new Set<string>();
  const results: ScrapedReview[] = [];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const review = parseReviewElement(el);
      if (review && !seen.has(review.text)) {
        seen.add(review.text);
        results.push(review);
      }
    });
  }

  return results;
}

export function applyReviewFilter(reviews: ScrapedReview[], filter: ReviewFilter): ScrapedReview[] {
  const now = Date.now();

  switch (filter) {
    case 'negative':
      return reviews.filter((r) => (r.rating ?? inferRating(r.text)) <= 3);
    case 'with_photo':
      return reviews.filter((r) => r.hasPhoto);
    case 'last_month':
      return reviews.filter((r) => !r.timestamp || now - r.timestamp <= ONE_MONTH_MS);
    default:
      return reviews;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openOzonReviewsSection(allowNavigation: boolean): Promise<void> {
  if (allowNavigation) {
    const tabButtons = document.querySelectorAll<HTMLElement>(
      '[data-widget="webReviewTabs"] button, [data-widget="webReviewTabs"] a, button[class*="tab"]',
    );

    for (const button of tabButtons) {
      const text = button.textContent?.toLowerCase() ?? '';
      if (text.includes('отзыв') || text.includes('review')) {
        button.click();
        await delay(1500);
        break;
      }
    }
  }

  scrollToReviewsSection();
  if (allowNavigation) await delay(2500);
}

async function openYandexReviewsSection(allowNavigation: boolean): Promise<void> {
  const onReviewsPage = /\/reviews(?:\/|$|\?)/i.test(window.location.pathname);

  if (allowNavigation && !onReviewsPage) {
    const tabSelectors = [
      '[data-auto="product-tabs"] button',
      '[data-auto="product-tabs"] a',
      'nav[data-auto="product-tabs"] button',
      'button[data-auto="tab-reviews"]',
      '[data-zone-name="reviews"] a',
      '[data-auto="tabs"] button',
    ];

    for (const selector of tabSelectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      for (const el of elements) {
        const label = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
        if (label.includes('отзыв') || label.includes('review')) {
          el.click();
          await delay(2_000);
          break;
        }
      }
    }
  }

  scrollToReviewsSection();
  if (!allowNavigation) return;

  await delay(onReviewsPage ? 800 : 2_500);

  const showMore = document.querySelector<HTMLElement>(
    [
      '[data-auto="show-more-reviews"]',
      'button[class*="ShowMore"]',
      'button[class*="show-more"]',
    ].join(', '),
  );
  if (showMore) {
    showMore.click();
    await delay(1_500);
  }
}

function scrapeYandexReviewsFromJson(): ScrapedReview[] {
  const seen = new Set<string>();
  const results: ScrapedReview[] = [];

  const tryPush = (text: unknown, rating?: unknown) => {
    if (typeof text !== 'string') return;
    const trimmed = text.trim();
    if (trimmed.length < 15 || trimmed.length > 2000 || seen.has(trimmed)) return;
    seen.add(trimmed);
    const numRating =
      typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : undefined;
    results.push({
      text: trimmed,
      rating: numRating ?? inferRating(trimmed),
    });
  };

  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 14) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;

    const text =
      obj.text ??
      obj.comment ??
      obj.body ??
      obj.reviewText ??
      obj.fullText ??
      obj.content;
    const rating = obj.rating ?? obj.grade ?? obj.score ?? obj.stars;

    if (typeof text === 'string') {
      tryPush(text, rating);
    }

    for (const value of Object.values(obj)) {
      walk(value, depth + 1);
    }
  };

  document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]').forEach((script) => {
    try {
      walk(JSON.parse(script.textContent ?? ''));
    } catch {
      // ignore invalid json
    }
  });

  const nextData = (window as unknown as { __NEXT_DATA__?: unknown }).__NEXT_DATA__;
  if (nextData) walk(nextData);

  return results;
}

async function openWildberriesReviewsSection(allowNavigation: boolean): Promise<void> {
  const onFeedbacksPage = /\/feedbacks/i.test(window.location.pathname);

  if (allowNavigation && !onFeedbacksPage) {
    const feedbackLink = document.querySelector<HTMLElement>(
      'a[href*="/feedbacks"], a[href*="feedbacks"], [data-link="feedbacks"], [data-link="comments"], button[data-link="feedbacks"]',
    );
    if (feedbackLink) {
      feedbackLink.click();
      await delay(1200);
    } else {
      const article = window.location.href.match(/\/catalog\/(\d+)/i)?.[1];
      if (article) {
        window.location.href = `https://www.wildberries.ru/catalog/${article}/feedbacks`;
        await delay(2500);
      }
    }
  }

  scrollToReviewsSection();
  if (allowNavigation) await delay(2000);
}

export interface ScrapeReviewsOptions {
  /** false = только DOM/JSON на текущей странице, без кликов и переходов */
  allowNavigation?: boolean;
}

export async function scrapeReviews(
  marketplace: Marketplace,
  filter: ReviewFilter = 'all',
  options: ScrapeReviewsOptions = {},
): Promise<ScrapeReviewsResult> {
  const allowNavigation = options.allowNavigation === true;
  let allReviews: ScrapedReview[] = [];

  if (marketplace === 'wildberries') {
    // DOM only — WB feedbacks API только из SW (collect-reviews / scrape-via-tab).
    // fetch с карточки wildberries.ru → CORS noise (credentials + ACAO *).
    await openWildberriesReviewsSection(allowNavigation);

    for (let attempt = 0; attempt < 3 && allReviews.length < 5; attempt++) {
      allReviews = scrapeReviewsFromDom(WB_REVIEW_SELECTORS);
      if (allReviews.length >= 5) break;
      scrollToReviewsSection();
      await delay(2000);
    }
  } else if (marketplace === 'ozon') {
    await openOzonReviewsSection(allowNavigation);

    for (let attempt = 0; attempt < 3 && allReviews.length < 5; attempt++) {
      allReviews = scrapeReviewsFromDom(OZON_REVIEW_SELECTORS);
      if (allReviews.length >= 5) break;
      scrollToReviewsSection();
      await delay(2000);
    }
  } else if (marketplace === 'yandex_market') {
    await openYandexReviewsSection(allowNavigation);

    for (let attempt = 0; attempt < 4 && allReviews.length < 5; attempt++) {
      const fromDom = scrapeReviewsFromDom(YANDEX_REVIEW_SELECTORS);
      const fromJson = scrapeYandexReviewsFromJson();

      const seen = new Set<string>();
      allReviews = [];
      for (const r of [...fromDom, ...fromJson]) {
        if (!seen.has(r.text)) {
          seen.add(r.text);
          allReviews.push(r);
        }
      }

      if (allReviews.length >= 5) break;
      scrollToReviewsSection();
      await delay(2_000);
    }
  }

  const totalFound = allReviews.length;
  const filtered = applyReviewFilter(allReviews, filter).slice(0, 30);

  return { reviews: filtered, totalFound };
}

export function scrollToReviewsSection(): void {
  const anchor = queryFirst([
    '#comments',
    '[data-link="feedbacks"]',
    '[class*="feedback"]',
    '[data-widget="webReview"]',
    '[data-widget="webListReviews"]',
    '[data-widget="paginatedReviews"]',
    'a[href*="comments"]',
    'a[href*="review"]',
    '[data-zone-name="reviews"]',
    '[data-auto="reviews"]',
    '[data-auto="product-tabs"]',
    'a[href*="reviews"]',
  ]);

  anchor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
