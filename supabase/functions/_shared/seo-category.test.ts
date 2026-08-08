import { describe, expect, it } from 'vitest';
import { inferSeoCategoryFromTitle } from './seo-category.ts';

describe('inferSeoCategoryFromTitle', () => {
  it('maps earbuds / buds to headphones', () => {
    const cat = inferSeoCategoryFromTitle('Xiaomi Redmi Buds 6 Active');
    expect(cat?.id).toBe('headphones');
    expect(cat?.slug).toBe('headphones');
    expect(cat?.labelRu).toBe('Наушники');
  });

  it('maps smartphone keywords', () => {
    expect(inferSeoCategoryFromTitle('Смартфон Samsung Galaxy S24')?.id).toBe(
      'smartphones',
    );
  });

  it('returns null for unknown / generic titles', () => {
    expect(inferSeoCategoryFromTitle('Товар без категории XYZ-99')).toBeNull();
    expect(inferSeoCategoryFromTitle('')).toBeNull();
  });

  it('prefers accessories over host device words in чехол titles', () => {
    expect(inferSeoCategoryFromTitle('Чехол для iPhone 15 Pro')?.id).toBe(
      'accessories',
    );
  });
});
