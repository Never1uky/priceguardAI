import { describe, expect, it } from 'vitest';
import { isWildberriesFeedbacksUrl, offerLinkUrl, toCanonicalProductUrl } from '@/utils/product-url';
import { isProductPageUrl } from '@/lib/product-match';

describe('toCanonicalProductUrl', () => {
  it('converts WB feedbacks to detail.aspx', () => {
    expect(
      toCanonicalProductUrl('https://www.wildberries.ru/catalog/292619464/feedbacks?size=1'),
    ).toBe('https://www.wildberries.ru/catalog/292619464/detail.aspx');
  });

  it('normalizes bare WB catalog id to detail.aspx', () => {
    expect(toCanonicalProductUrl('https://www.wildberries.ru/catalog/292619464')).toBe(
      'https://www.wildberries.ru/catalog/292619464/detail.aspx',
    );
  });
});

describe('offerLinkUrl', () => {
  it('fixes feedbacks links in compare table', () => {
    expect(
      offerLinkUrl('https://www.wildberries.ru/catalog/292619464/feedbacks', 'wildberries'),
    ).toBe('https://www.wildberries.ru/catalog/292619464/detail.aspx');
  });
});

describe('isWildberriesFeedbacksUrl', () => {
  it('detects feedbacks path', () => {
    expect(isWildberriesFeedbacksUrl('https://www.wildberries.ru/catalog/1/feedbacks')).toBe(true);
    expect(isProductPageUrl('https://www.wildberries.ru/catalog/1/feedbacks')).toBe(false);
  });
});
