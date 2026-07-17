/**
 * E2E live-тесты — только при E2E_LIVE=1.
 *
 * Проверяют реальные API маркетплейсов. При блокировке (403/timeout)
 * тест мягко пропускается с console.warn — CI не падает из-за антибота WB.
 *
 * @see src/e2e/config.ts
 */

import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { scanHtmlForAuthenticity } from '@/lib/authenticity/detect-core';
import { extractProductModel } from '@/lib/model-extract';
import { pickBestMatch } from '@/lib/product-match';
import { parseWbFeedbacksPayload } from '@/lib/reviews/wb-feedbacks';
import { analyzeReviewsLocally } from '@/lib/ai/local-fallback';
import { fetchWildberriesProduct, fetchWildberriesReviews } from '@/utils/parsers/wb-api';
import { fetchOzonOfferFromPage } from '@/lib/ozon-offer';
import { fetchYandexOfferFromPage } from '@/lib/yandex-offer';
import { searchMarketplace } from '@/lib/marketplace-search';
import { MIN_REVIEWS_FOR_ANALYSIS } from '@/types/review-analysis';
import { E2E_AI_LIVE, E2E_LIVE, LIVE_PRODUCTS, LIVE_TEST_TIMEOUT_MS, WB_DEST } from '@/e2e/config';

const { wildberries: WB, ozon: OZ, yandex_market: YM } = LIVE_PRODUCTS;

/** Мягкий skip: не валим CI при блокировке WB */
function softAssert<T>(value: T | null | undefined, label: string): value is T {
  if (value == null) {
    console.warn(`[E2E live] ${label} — пропуск (блокировка или пустой ответ)`);
    return false;
  }
  return true;
}

describe.skipIf(!E2E_LIVE)('E2E live — поиск товара', () => {
  it('WB search API: находит AirPods Max по названию', async () => {
    const query = WB.searchQuery;
    const apiUrl =
      `https://search.wb.ru/exactmatch/ru/common/v5/search` +
      `?appType=1&curr=rub&dest=${WB_DEST}&query=${encodeURIComponent(query)}` +
      `&resultset=catalog&sort=popular&spp=30&page=1`;

    const response = await fetchWithRetry(apiUrl);
    if (!response.ok) {
      console.warn('[E2E live] WB search blocked, status', response.status);
      return;
    }

    const data = (await response.json()) as {
      data?: { products?: Array<{ id?: number; name?: string; brand?: string; salePriceU?: number }> };
    };
    const products = data.data?.products ?? [];
    if (!softAssert(products.length > 0, 'WB search API')) return;

    const best = pickBestMatch(
      query,
      products,
      (p) => `${p.brand ?? ''} ${p.name ?? ''}`.trim(),
      { referencePrice: 55_000 },
    );
    expect(best).toBeTruthy();
    expect(best!.id).toBeTruthy();
  }, LIVE_TEST_TIMEOUT_MS);

  it('searchMarketplace: возвращает оффер с ценой', async () => {
    const model = extractProductModel(WB.title);
    const query = model.searchQuery || WB.searchQuery;

    const offer = await searchMarketplace('wildberries', query, WB.title, 55_000);
    if (!offer.found) {
      console.warn('[E2E live] searchMarketplace not found:', offer.error);
      return;
    }

    expect(offer.price).toBeGreaterThan(WB.minPrice);
    expect(offer.price).toBeLessThan(WB.maxPrice);
    if (offer.rating != null) expect(offer.rating).toBeGreaterThan(3);
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!E2E_LIVE)('E2E live — парсинг карточки', () => {
  it('fetchWildberriesProduct: цена, рейтинг, отзывы', async () => {
    const api = await fetchWildberriesProduct(WB.nmId);
    if (!softAssert(api, 'WB card API')) return;

    expect(api.price).toBeGreaterThan(WB.minPrice);
    expect(api.title.toLowerCase()).toMatch(/airpods|apple/i);
    if (api.reviewRating != null) expect(api.reviewRating).toBeGreaterThan(3);
    if (api.feedbacks != null) expect(api.feedbacks).toBeGreaterThan(0);
  }, LIVE_TEST_TIMEOUT_MS);

  it('WB catalog HTML: структура и оригинальность (smoke)', async () => {
    const url = `https://www.wildberries.ru/catalog/${WB.nmId}/detail.aspx`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.warn('[E2E live] WB HTML fetch failed:', error);
      return;
    }

    if (!response.ok) {
      console.warn('[E2E live] WB HTML blocked, status', response.status);
      return;
    }

    const html = await response.text();
    expect(html.length).toBeGreaterThan(1000);
    const auth = scanHtmlForAuthenticity('wildberries', html, WB.title);
    expect(['original', 'not_original', 'unknown']).toContain(auth.status);
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!E2E_LIVE)('E2E live — отзывы', () => {
  it('fetchWildberriesReviews: загружает тексты отзывов', async () => {
    const items = await fetchWildberriesReviews(WB.nmId, 20);
    if (!softAssert(items.length > 0, 'WB reviews API')) return;

    expect(items[0].text.length).toBeGreaterThan(5);
    const parsed = parseWbFeedbacksPayload({ feedbacks: items.map((r) => ({ text: r.text, productValuation: r.rating })) });
    expect(parsed.length).toBeGreaterThan(0);
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!E2E_LIVE)('E2E live — AI-анализ', () => {
  it('локальный AI-анализ на живых отзывах', async () => {
    const items = await fetchWildberriesReviews(WB.nmId, 15);
    if (!softAssert(items.length >= 3, 'reviews for local AI')) return;

    const result = analyzeReviewsLocally({
      reviews: items.map((r) => r.text),
      productTitle: WB.title,
      productPrice: 55_000,
      marketplace: 'wildberries',
      totalReviewsFound: items.length,
    });

    expect(result.verdict).toBeTruthy();
    expect(result.summary.length).toBeGreaterThan(10);
  }, LIVE_TEST_TIMEOUT_MS);

  it.skipIf(!E2E_AI_LIVE)('облачный AI через ai-proxy (E2E_AI_LIVE=1)', async () => {
    // Требует VITE_SUPABASE_* в .env — тратит токены, только по явному флагу
    const { isCloudAiAvailable, sendToAIWithFallback } = await import('@/api/ai');
    if (!isCloudAiAvailable()) {
      console.warn('[E2E live] Supabase не настроен — пропуск cloud AI');
      return;
    }

    const { text } = await sendToAIWithFallback(
      'You are a test assistant.',
      'Reply with exactly: OK',
      { maxTokens: 16 },
    );
    expect(text.toLowerCase()).toContain('ok');
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!E2E_LIVE)('E2E live — Ozon', () => {
  it('searchMarketplace: поиск AirPods Pro 2', async () => {
    const offer = await searchMarketplace('ozon', OZ.searchQuery, OZ.title, 25_000);
    if (!offer.found) {
      console.warn('[E2E live] Ozon search not found:', offer.error);
      return;
    }
    expect(offer.price).toBeGreaterThan(OZ.minPrice);
    expect(offer.price).toBeLessThan(OZ.maxPrice);
  }, LIVE_TEST_TIMEOUT_MS);

  it('fetchOzonOfferFromPage: парсинг карточки (smoke)', async () => {
    try {
      const offer = await fetchOzonOfferFromPage(OZ.url);
      if (!softAssert(offer, 'Ozon card API')) return;
      if (offer.price) expect(offer.price).toBeGreaterThan(5_000);
    } catch (error) {
      console.warn('[E2E live] Ozon fetch failed:', error);
    }
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!E2E_LIVE)('E2E live — Яндекс.Маркет', () => {
  it('searchMarketplace: поиск AirPods Pro 2', async () => {
    const offer = await searchMarketplace('yandex_market', YM.searchQuery, YM.title, 25_000);
    if (!offer.found) {
      console.warn('[E2E live] YM search not found:', offer.error);
      return;
    }
    expect(offer.price).toBeGreaterThan(YM.minPrice);
    expect(offer.price).toBeLessThan(YM.maxPrice);
  }, LIVE_TEST_TIMEOUT_MS);

  it('fetchYandexOfferFromPage: парсинг карточки (smoke)', async () => {
    try {
      const offer = await fetchYandexOfferFromPage(YM.url);
      if (!softAssert(offer, 'YM card page')) return;
      if (offer.price) expect(offer.price).toBeGreaterThan(5_000);
    } catch (error) {
      console.warn('[E2E live] YM fetch failed:', error);
    }
  }, LIVE_TEST_TIMEOUT_MS);
});

describe.skipIf(!E2E_LIVE)('E2E live — ANALYZE_REVIEWS pipeline', () => {
  it('WB: collectReviewsForProduct + локальный AI', async () => {
    const { collectReviewsForProduct } = await import('@/lib/reviews/collect-reviews');
    const url = `https://www.wildberries.ru/catalog/${WB.nmId}/detail.aspx`;

    const collected = await collectReviewsForProduct({
      productUrl: url,
      marketplace: 'wildberries',
      article: WB.nmId,
      preferActiveTab: false,
      preferCurrentPage: false,
    });

    if (!softAssert(collected.reviews.length >= MIN_REVIEWS_FOR_ANALYSIS, 'WB collectReviews')) {
      return;
    }

    expect(collected.previewItems.length).toBeGreaterThan(0);
    expect(collected.insufficient).toBe(false);

    const result = analyzeReviewsLocally({
      reviews: collected.reviews,
      productTitle: WB.title,
      productPrice: 55_000,
      marketplace: 'wildberries',
      totalReviewsFound: collected.totalFound,
    });

    expect(result.verdict).toBeTruthy();
    expect(result.reviewsAnalyzed).toBeGreaterThanOrEqual(MIN_REVIEWS_FOR_ANALYSIS);
  }, LIVE_TEST_TIMEOUT_MS);

  it('Ozon: поиск карточки + collect + локальный AI (smoke)', async () => {
    const { collectReviewsForProduct } = await import('@/lib/reviews/collect-reviews');
    const offer = await searchMarketplace('ozon', OZ.searchQuery, OZ.title, 25_000);
    if (!offer.found || !offer.url) {
      console.warn('[E2E live] Ozon offer for ANALYZE_REVIEWS not found');
      return;
    }

    const collected = await collectReviewsForProduct({
      productUrl: offer.url,
      marketplace: 'ozon',
      preferActiveTab: false,
      preferCurrentPage: false,
    });

    if (!softAssert(collected.reviews.length >= 3, 'Ozon collectReviews (smoke)')) {
      return;
    }

    const result = analyzeReviewsLocally({
      reviews: collected.reviews,
      productTitle: offer.title,
      productPrice: offer.price ?? 25_000,
      marketplace: 'ozon',
      totalReviewsFound: collected.totalFound,
    });

    expect(result.summary.length).toBeGreaterThan(10);
  }, LIVE_TEST_TIMEOUT_MS);
});
