import { describe, expect, it } from 'vitest';
import { getReviewCacheKey } from '@/lib/reviews/cache-key';

describe('getReviewCacheKey', () => {
  it('uses marketplace+article as primary key', () => {
    const a = getReviewCacheKey({
      url: 'https://www.wildberries.ru/catalog/292619464/feedbacks',
      marketplace: 'wildberries',
      article: '292619464',
      id: 'wb-111',
    });
    const b = getReviewCacheKey({
      url: 'https://www.wildberries.ru/catalog/292619464/detail.aspx',
      marketplace: 'wildberries',
      article: '292619464',
      id: 'wb-222',
    });
    expect(a).toBe(b);
    expect(a).toBe('mp:wildberries:292619464');
  });

  it('uses normalized url when article missing', () => {
    const a = getReviewCacheKey({
      url: 'https://www.wildberries.ru/catalog/292619464/detail.aspx?size=1',
      id: 'wb-111',
    });
    const b = getReviewCacheKey({
      url: 'https://www.wildberries.ru/catalog/292619464/detail.aspx',
      id: 'wb-222',
    });
    expect(a).toBe(b);
  });

  it('differs for different products', () => {
    const airpods = getReviewCacheKey({
      url: 'https://www.wildberries.ru/catalog/292619464/detail.aspx',
    });
    const rtx = getReviewCacheKey({
      url: 'https://www.wildberries.ru/catalog/537082116/detail.aspx',
    });
    expect(airpods).not.toBe(rtx);
  });
});
