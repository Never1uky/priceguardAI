/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrapeReviews } from '@/utils/parsers/reviews';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ymReviewsHtml = readFileSync(
  join(__dirname, 'fixtures', 'ym-reviews-section.html'),
  'utf8',
);

describe('YM reviews fixture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('парсит отзывы с вкладки Я.Маркет', async () => {
    document.documentElement.innerHTML = ymReviewsHtml;

    const resultPromise = scrapeReviews('yandex_market', 'all');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalFound).toBeGreaterThanOrEqual(5);
    expect(result.reviews.length).toBeGreaterThanOrEqual(5);
    expect(result.reviews.some((r) => r.text.includes('шумоподавление'))).toBe(true);
  });
});
