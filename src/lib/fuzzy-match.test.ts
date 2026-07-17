import { describe, expect, it } from 'vitest';
import { levenshteinSimilarity, matchConfidencePercent } from '@/lib/fuzzy-match';
import { computeMatchConfidence } from '@/lib/product-match';

describe('fuzzy-match', () => {
  it('levenshteinSimilarity: identical strings', () => {
    expect(levenshteinSimilarity('iPhone 15 Pro', 'iPhone 15 Pro')).toBe(1);
  });

  it('matchConfidencePercent rounds score', () => {
    expect(matchConfidencePercent(0.876)).toBe(88);
  });

  it('computeMatchConfidence for similar AirPods titles', () => {
    const score = computeMatchConfidence(
      'Apple AirPods Max серебристый',
      'Наушники Apple AirPods Max Silver',
    );
    expect(score).toBeGreaterThan(50);
  });

  it('rejects Redmi vs Realme brand mismatch', () => {
    const score = computeMatchConfidence(
      'Смартфон Redmi Note 14S Blue 8G+128G',
      'realme Смартфон 16 5G 8/256 ГБ',
    );
    expect(score).toBeLessThan(52);
  });

  it('rejects ASUS laptop vs Xiaomi phone', () => {
    const score = computeMatchConfidence(
      'ASUS E1504FA-BQ4328 Ноутбук 15.60"',
      'Смартфон Xiaomi Redmi Note 14S 4G 8/256 Gb',
    );
    expect(score).toBeLessThan(52);
  });
});
