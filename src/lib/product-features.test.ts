import {
  buildFeatureSearchQuery,
  extractProductFeatures,
  scoreFeatureMatch,
} from '@/lib/product-features';
import { describe, expect, it } from 'vitest';

describe('product-features', () => {
  it('scores same phone high', () => {
    const ref = extractProductFeatures('Смартфон Realme 15 8/256GB черный');
    const cand = extractProductFeatures('Realme 15 8+256 Black');
    const { score } = scoreFeatureMatch(ref, cand, true);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('penalizes different storage hard', () => {
    const ref = extractProductFeatures('Смартфон Realme 15 8/256GB черный');
    const cand = extractProductFeatures('Realme 15 8/128GB Black');
    const { score } = scoreFeatureMatch(ref, cand, true);
    expect(score).toBeLessThan(50);
  });

  it('penalizes MacBook TB vs GB configs', () => {
    const ref = extractProductFeatures('Apple MacBook Pro 14 M5 24+1 ТБ');
    const cand = extractProductFeatures('Apple MacBook Pro 14 M5 16/512Gb');
    expect(ref.storage).toBeTruthy();
    expect(cand.storage).toBeTruthy();
    const { score } = scoreFeatureMatch(ref, cand, true);
    expect(score).toBeLessThan(50);
  });

  it('builds structured search query', () => {
    const f = extractProductFeatures('Смартфон Xiaomi Redmi Note 13 8/256GB синий');
    const q = buildFeatureSearchQuery(f);
    expect(q.toLowerCase()).toMatch(/redmi|xiaomi/);
    expect(q).toMatch(/8/);
    expect(q).toMatch(/256/);
  });

  it('Pixel 8 query includes model number and numeric storage, not bare GB', () => {
    const f = extractProductFeatures(
      'Смартфон Google Pixel 8 8/128Gb светло-желтый Lemongrass',
    );
    expect(f.model?.toLowerCase()).toMatch(/pixel\s*8/);
    const q = buildFeatureSearchQuery(f);
    expect(q.toLowerCase()).toMatch(/pixel\s*8/);
    expect(q).toMatch(/128|8\s+128/);
    expect(q).not.toMatch(/(?<!\d)\s*(?:ГБ|GB)\b/i);
    expect(q).not.toContain(', ,');
  });

  it('does not duplicate Google when model already includes brand', () => {
    const q = buildFeatureSearchQuery({
      title: 'Смартфон Google Pixel 7',
      brand: 'Google',
      model: 'Google Pixel 7',
      storage: '128gb',
    });
    expect(q.toLowerCase()).not.toMatch(/google\s+google/);
    expect(q.toLowerCase()).toMatch(/pixel\s*7/);
  });
});
