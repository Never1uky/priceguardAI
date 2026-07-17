import { describe, expect, it } from 'vitest';
import { analyzeReviewsLocally } from '@/lib/ai/local-fallback';

describe('analyzeReviewsLocally', () => {
  it('uses explicit star ratings when provided', () => {
    const result = analyzeReviewsLocally({
      reviews: ['Отличный товар', 'Нормально', 'Ужасный брак'],
      reviewRatings: [5, 4, 1],
      productTitle: 'Test Phone',
    });
    expect(result.overallRating).toBeGreaterThan(3.2);
    expect(result.overallRating).not.toBe(3.2);
  });

  it('returns high rating for mostly positive reviews', () => {
    const result = analyzeReviewsLocally({
      reviews: [
        'Отличное качество, очень доволен покупкой',
        'Камера снимает прекрасно, рекомендую',
        'Удобный и лёгкий, всем советую',
        'Соответствует описанию, быстрая доставка',
        'Прекрасный товар за свои деньги',
      ],
      reviewRatings: [5, 5, 4, 5, 5],
      productTitle: 'Instax Mini 12',
    });
    expect(result.overallRating).toBeGreaterThanOrEqual(4.5);
    expect(result.verdict).toBe('buy_now');
  });

  it('returns low rating for mostly negative reviews', () => {
    const result = analyzeReviewsLocally({
      reviews: Array.from({ length: 8 }, () => 'Плохой товар, брак, не рекомендую'),
      reviewRatings: Array.from({ length: 8 }, () => 1),
      productTitle: 'Bad Product',
    });
    expect(result.overallRating).toBeLessThan(3);
    expect(result.verdict).toBe('not_recommended');
  });
});
