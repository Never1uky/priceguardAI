import { describe, expect, it } from 'vitest';
import {
  buildSeoCanonId,
  chooseSeoPrimary,
  guessStorageFromTitle,
} from './seo-canon.ts';

describe('buildSeoCanonId', () => {
  it('builds canon for brand+model', () => {
    const id = buildSeoCanonId({
      title: 'Samsung Galaxy Buds FE',
      brand: 'Samsung',
      category: 'naushniki',
    });
    expect(id).toMatch(/^canon:samsung\|/);
    expect(id).toContain('galaxybudsfe');
  });

  it('CASE 4: different storage → different canon', () => {
    const a = buildSeoCanonId({
      title: 'Apple iPhone 15 128GB',
      brand: 'Apple',
    });
    const b = buildSeoCanonId({
      title: 'Apple iPhone 15 256GB',
      brand: 'Apple',
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('returns null for weak titles', () => {
    expect(buildSeoCanonId({ title: '12345' })).toBeNull();
  });
});

describe('guessStorageFromTitle', () => {
  it('extracts GB', () => {
    expect(guessStorageFromTitle('Phone 128 ГБ black')).toBe('128gb');
  });
});

describe('chooseSeoPrimary', () => {
  it('prefers existing is_primary', () => {
    const primary = chooseSeoPrimary(
      {
        slug: 'new',
        product_key: 'ozon:1',
        quality_score: 9,
        published_at: '2026-01-02T00:00:00Z',
        is_primary: true,
      },
      [
        {
          slug: 'old',
          product_key: 'wildberries:2',
          quality_score: 8,
          published_at: '2026-01-01T00:00:00Z',
          is_primary: true,
        },
      ],
    );
    // both marked primary → higher quality wins
    expect(primary.product_key).toBe('ozon:1');
  });

  it('picks higher quality when none marked', () => {
    const primary = chooseSeoPrimary(
      {
        slug: 'a',
        product_key: 'ozon:1',
        quality_score: 7,
        published_at: '2026-01-02T00:00:00Z',
        is_primary: false,
      },
      [
        {
          slug: 'b',
          product_key: 'wildberries:2',
          quality_score: 9,
          published_at: '2026-01-01T00:00:00Z',
          is_primary: false,
        },
      ],
    );
    expect(primary.slug).toBe('b');
  });
});
