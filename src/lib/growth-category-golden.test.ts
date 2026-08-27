/**
 * Growth P1.1 — category golden pairs (same SKU > same title).
 * Small regressions only; do not weaken existing hard gates.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_COMPARE_MATCH_CONFIDENCE,
  computeMatchConfidence,
  scoreProductMatch,
} from '@/lib/product-match';

describe('growth category golden pairs (P1.1)', () => {
  it('smartphones: iPhone 15 ≠ iPhone 15 Pro hard mismatch (tier gate)', () => {
    expect(
      scoreProductMatch(
        'Смартфон Apple iPhone 15 128GB',
        'Смартфон Apple iPhone 15 Pro 128GB',
        undefined,
        'smartphones',
      ),
    ).toBe(0);
    expect(
      computeMatchConfidence(
        'Apple iPhone 15 128GB чёрный',
        'Apple iPhone 15 Pro 128GB чёрный',
      ),
    ).toBeLessThan(MIN_COMPARE_MATCH_CONFIDENCE);
  });

  it('smartphones: iPhone 15 Pro ≠ iPhone 15 Pro Max', () => {
    expect(
      scoreProductMatch(
        'Apple iPhone 15 Pro 256GB',
        'Apple iPhone 15 Pro Max 256GB',
        undefined,
        'smartphones',
      ),
    ).toBe(0);
  });

  it('smartphones: same iPhone 15 tier still matches (cross-MP titles)', () => {
    expect(
      scoreProductMatch(
        'Смартфон Apple iPhone 15 128GB',
        'Apple iPhone 15 128 ГБ',
        undefined,
        'smartphones',
      ),
    ).toBeGreaterThan(0);
    expect(
      computeMatchConfidence('iPhone 15 128GB', 'Смартфон Apple iPhone 15 128 ГБ чёрный'),
    ).toBeGreaterThanOrEqual(MIN_COMPARE_MATCH_CONFIDENCE);
  });

  it('smartphones: storage 128GB ≠ 256GB hard mismatch', () => {
    expect(
      scoreProductMatch(
        'Смартфон Samsung Galaxy S24 128GB',
        'Смартфон Samsung Galaxy S24 256GB',
        undefined,
        'smartphones',
      ),
    ).toBe(0);
  });

  it('headphones: AirPods Pro 2 ≠ AirPods Max', () => {
    const conf = computeMatchConfidence(
      'Apple AirPods Pro 2 USB-C',
      'Apple AirPods Max',
    );
    expect(conf).toBeLessThan(MIN_COMPARE_MATCH_CONFIDENCE);
  });

  it('consoles: PS5 Disc ≠ PS5 Digital', () => {
    expect(
      scoreProductMatch(
        'Sony PlayStation 5 Disc Edition',
        'Sony PlayStation 5 Digital Edition',
        undefined,
        'consoles',
      ),
    ).toBe(0);
  });

  it('gamepads: DualSense accessory ≠ PS5 console', () => {
    expect(
      scoreProductMatch(
        'Беспроводной контроллер DualSense для PlayStation 5',
        'Игровая приставка Sony PlayStation 5',
        undefined,
        'accessories',
      ),
    ).toBe(0);
  });

  it('apparel: same model different size stays soft-compatible', () => {
    expect(
      computeMatchConfidence(
        'Футболка Nike Dri-FIT мужская чёрная размер M',
        'Футболка Nike Dri-FIT мужская черная размер L',
      ),
    ).toBeGreaterThanOrEqual(MIN_COMPARE_MATCH_CONFIDENCE);
  });

  it('shoes: different size is soft (not score 0)', () => {
    const score = scoreProductMatch(
      'Кроссовки Nike Air Force 1 белые 42',
      'Кроссовки Nike Air Force 1 белые 43',
      undefined,
      'shoes',
    );
    expect(score).toBeGreaterThan(0);
  });

  it('appliances: Dyson host ≠ «фен для Dyson» dependent', () => {
    expect(
      scoreProductMatch('Фен Dyson Supersonic HD08', 'Фен для Dyson Supersonic HD08'),
    ).toBe(0);
  });

  it('cosmetics: Menthol ≠ Citrus scent', () => {
    expect(
      scoreProductMatch(
        'Head & Shoulders шампунь Ментол 600 мл',
        'Head & Shoulders шампунь Цитрусовая свежесть 600 мл',
        undefined,
        'cosmetics',
      ),
    ).toBe(0);
  });

  it('detergents: package count 2 шт ≠ 1 шт', () => {
    expect(
      scoreProductMatch(
        'Persil Color гель 1.3 л 2 шт',
        'Persil Color гель 1.3 л 1 шт',
        undefined,
        'detergents',
      ),
    ).toBe(0);
  });

  it('headphones lineage: WH-1000XM5 ≠ WH-1000XM6', () => {
    expect(
      scoreProductMatch(
        'Sony WH-1000XM5 беспроводные наушники',
        'Sony WH-1000XM6 беспроводные наушники',
        undefined,
        'headphones',
      ),
    ).toBe(0);
  });
});
