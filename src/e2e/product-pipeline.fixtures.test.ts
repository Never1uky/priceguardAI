/**
 * E2E offline (fixture) тесты — запускаются всегда через `npm run test`.
 *
 * Проверяют полный пайплайн без сети:
 *   поиск по названию/модели → парсинг цены/рейтинга → отзывы → локальный AI-анализ.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeReviewsLocally } from '@/lib/ai/local-fallback';
import { scanHtmlForAuthenticity } from '@/lib/authenticity/detect-core';
import { extractProductModel } from '@/lib/model-extract';
import { pickBestMatch } from '@/lib/product-match';
import { parseWbFeedbacksPayload } from '@/lib/reviews/wb-feedbacks';
import { PRODUCT_CACHE_TTL_MS } from '@/lib/supabase/product-cache';
import {
  parseEmbeddedWbState,
  parseRatingFromFixture,
  parseRubFromFixture,
} from '@/e2e/helpers/html-parsers';
import { parseOzonFixture, parseYmFixture } from '@/e2e/helpers/marketplace-fixtures';
import { parseAllOzonSearchOffers } from '@/lib/ozon-offer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const wbCardHtml = readFileSync(join(fixturesDir, 'wb-product-card.html'), 'utf8');
const wbSearchFixture = JSON.parse(
  readFileSync(join(fixturesDir, 'wb-search-response.json'), 'utf8'),
) as {
  data: {
    products: Array<{
      id: number;
      name?: string;
      brand?: string;
      salePriceU?: number;
      priceU?: number;
      reviewRating?: number;
      feedbacks?: number;
    }>;
  };
};
const wbReviewsFixture = JSON.parse(
  readFileSync(join(fixturesDir, 'wb-reviews-response.json'), 'utf8'),
) as { feedbacks: Array<{ text: string; productValuation?: number }> };
const ozonWidgetFixture = JSON.parse(
  readFileSync(join(fixturesDir, 'ozon-search-widget.json'), 'utf8'),
) as Record<string, string>;
const ozonCardHtml = readFileSync(join(fixturesDir, 'ozon-product-card.html'), 'utf8');
const ymCardHtml = readFileSync(join(fixturesDir, 'ym-product-card.html'), 'utf8');
const ymSearchFixture = JSON.parse(
  readFileSync(join(fixturesDir, 'ym-search-response.json'), 'utf8'),
) as {
  results: Array<{ id: string; titles?: { raw?: string }; prices?: { value?: string }; rating?: number; opinions?: number }>;
};

/** Нормализация копеек WB API (как в marketplace-search) */
function normalizeKopecks(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  if (value >= 1000) return Math.round(value / 100);
  return value;
}

describe('E2E fixtures — поиск по названию/модели', () => {
  it('извлекает модель из длинного названия карточки', () => {
    const info = extractProductModel('Наушники Apple AirPods Max серебристый беспроводные');
    expect(info.model.toLowerCase()).toContain('airpods');
    expect(info.searchQuery.toLowerCase()).toContain('airpods');
  });

  it('pickBestMatch выбирает AirPods Max, а не generic TWS', () => {
    const products = wbSearchFixture.data.products;
    const query = 'Apple AirPods Max';

    const best = pickBestMatch(
      query,
      products,
      (p) => `${p.brand ?? ''} ${p.name ?? ''}`.trim(),
      { referencePrice: 55_000 },
    );

    expect(best).toBeTruthy();
    expect(best!.id).toBe(292619464);
  });

  it('строит оффер из фикстуры поискового API', () => {
    const product = wbSearchFixture.data.products[0];
    const price = normalizeKopecks(product.salePriceU);
    const oldPrice = normalizeKopecks(product.priceU);

    expect(price).toBeGreaterThan(30_000);
    expect(oldPrice).toBeGreaterThan(price);
    expect(product.reviewRating).toBeGreaterThan(4);
    expect(product.feedbacks).toBeGreaterThan(100);
  });
});

describe('E2E fixtures — парсинг цены, рейтинга, отзывов', () => {
  it('парсит цену и скидку из HTML карточки', () => {
    const price = parseRubFromFixture(wbCardHtml);
    expect(price).toBe(54_990);
    expect(wbCardHtml).toMatch(/69\s*990/);
  });

  it('парсит рейтинг и количество оценок', () => {
    const { rating, reviewCount } = parseRatingFromFixture(wbCardHtml);
    expect(rating).toBeCloseTo(4.8, 1);
    expect(reviewCount).toBe(1240);
  });

  it('читает встроенный JSON состояния WB', () => {
    const state = parseEmbeddedWbState(wbCardHtml);
    expect(state).not.toBeNull();
    expect(state!.title.toLowerCase()).toContain('airpods');
    expect(state!.price).toBe(54_990);
    expect(state!.rating).toBe(4.8);
    expect(state!.feedbacks).toBe(1240);
  });

  it('определяет бейдж «Оригинал»', () => {
    const auth = scanHtmlForAuthenticity('wildberries', wbCardHtml, 'Apple AirPods Max');
    expect(auth.status).toBe('original');
  });
});

describe('E2E fixtures — загрузка и парсинг отзывов', () => {
  it('парсит payload отзывов WB (v2 API)', () => {
    const items = parseWbFeedbacksPayload(wbReviewsFixture, 30);
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0].text.length).toBeGreaterThan(10);
    expect(items[0].rating).toBeGreaterThanOrEqual(1);
  });

  it('тексты отзывов пригодны для AI-анализа', () => {
    const items = parseWbFeedbacksPayload(wbReviewsFixture, 30);
    const texts = items.map((r) => r.text);
    expect(texts.every((t) => t.length > 5)).toBe(true);
  });
});

describe('E2E fixtures — AI-анализ (локальный fallback)', () => {
  it('анализирует отзывы без облачного API', () => {
    const items = parseWbFeedbacksPayload(wbReviewsFixture, 30);
    const texts = items.map((r) => r.text);

    const result = analyzeReviewsLocally({
      reviews: texts,
      productTitle: 'Apple AirPods Max',
      productPrice: 54_990,
      marketplace: 'wildberries',
      totalReviewsFound: 1240,
    });

    expect(result.reviewsAnalyzed).toBe(texts.length);
    expect(result.overallRating).toBeGreaterThan(0);
    expect(['buy_now', 'wait_discount', 'not_recommended']).toContain(result.verdict);
    expect(['low', 'medium', 'high']).toContain(result.fakeRisk);
    expect(result.summary.length).toBeGreaterThan(20);
  });
});

describe('E2E fixtures — Ozon', () => {
  it('парсит оффер из widgetStates поиска', () => {
    const offers = parseAllOzonSearchOffers(
      ozonWidgetFixture,
      'https://www.ozon.ru/search/?text=airpods',
    );
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].price).toBe(24_990);
    expect(offers[0].rating).toBeGreaterThan(4);
    expect(offers[0].reviewCount).toBeGreaterThan(100);
  });

  it('парсит HTML карточки Ozon', () => {
    const parsed = parseOzonFixture(ozonCardHtml);
    expect(parsed.price).toBe(24_990);
    expect(parsed.rating).toBeCloseTo(4.7, 1);
    expect(parsed.reviewCount).toBe(1245);
    expect(parsed.isOriginal).toBe(true);
  });
});

describe('E2E fixtures — Яндекс.Маркет', () => {
  it('читает фикстуру поискового API', () => {
    const item = ymSearchFixture.results[0];
    expect(item.titles?.raw?.toLowerCase()).toContain('airpods');
    expect(Number(item.prices?.value)).toBeGreaterThan(10_000);
    expect(item.rating).toBeGreaterThan(4);
    expect(item.opinions).toBeGreaterThan(100);
  });

  it('парсит HTML карточки YM', () => {
    const parsed = parseYmFixture(ymCardHtml);
    expect(parsed.price).toBe(24_990);
    expect(parsed.rating).toBeCloseTo(4.6, 1);
    expect(parsed.reviewCount).toBe(892);
  });
});

describe('E2E fixtures — ANALYZE_REVIEWS pipeline', () => {
  it('WB: превью отзывов + локальный AI (как ANALYZE_REVIEWS без сети)', () => {
    const reviews = parseWbFeedbacksPayload(wbReviewsFixture, 30);
    expect(reviews.length).toBeGreaterThanOrEqual(3);

    const texts = reviews.map((r) => r.text);
    const previewItems = reviews.slice(0, 3).map((r) => ({
      text: r.text.slice(0, 280),
      rating: r.rating,
      author: r.author ?? 'Покупатель',
    }));

    expect(previewItems.length).toBe(3);
    expect(previewItems[0]!.text.length).toBeGreaterThan(5);

    const analysis = analyzeReviewsLocally({
      reviews: texts,
      productTitle: 'Apple AirPods Max',
      productPrice: 54_990,
      marketplace: 'wildberries',
      totalReviewsFound: texts.length,
    });

    expect(analysis.reviewsAnalyzed).toBeGreaterThanOrEqual(3);
    expect(analysis.verdict).toBeTruthy();
    expect(analysis.summary.length).toBeGreaterThan(10);
  });

  it('Ozon: оффер из поиска + локальный AI на синтетических отзывах', () => {
    const offers = parseAllOzonSearchOffers(
      ozonWidgetFixture,
      'https://www.ozon.ru/search/?text=airpods',
    );
    expect(offers.length).toBeGreaterThan(0);

    const syntheticReviews = [
      'Отличный звук, оригинал, доставка быстрая',
      'Шумоподавление работает хорошо, но дорого',
      'Качество на высоте, рекомендую',
      'Немного тяжёлые, но комфортные',
      'Пришли в срок, всё работает',
    ];

    const analysis = analyzeReviewsLocally({
      reviews: syntheticReviews,
      productTitle: offers[0]!.title,
      productPrice: offers[0]!.price ?? 25_000,
      marketplace: 'ozon',
      totalReviewsFound: syntheticReviews.length,
    });

    expect(analysis.reviewsAnalyzed).toBe(5);
    expect(['buy_now', 'wait_discount', 'not_recommended']).toContain(analysis.verdict);
  });
});

describe('E2E fixtures — кэш Supabase (TTL)', () => {
  it('свежая запись — в пределах 7 дней', () => {
    const lastUpdated = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const fresh = Date.now() - lastUpdated < PRODUCT_CACHE_TTL_MS;
    expect(fresh).toBe(true);
  });

  it('устаревшая запись — старше 7 дней', () => {
    const lastUpdated = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const fresh = Date.now() - lastUpdated < PRODUCT_CACHE_TTL_MS;
    expect(fresh).toBe(false);
  });
});
