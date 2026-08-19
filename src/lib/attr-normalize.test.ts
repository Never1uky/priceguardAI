import { describe, expect, it } from 'vitest';
import {
  extractNormalizedColor,
  extractNormalizedConnector,
  extractNormalizedPackageCount,
  extractNormalizedStorage,
  extractNormalizedVolumeMl,
  normalizeConnector,
  normalizeColor,
  normalizePackageCount,
  normalizeStorage,
  normalizeVolumeMl,
} from '@/lib/attr-normalize';
import { inferProductCategory, MATCH_PROFILES } from '@/lib/match-category';
import {
  AUTO_PICK_CONFIDENCE_THRESHOLD,
  computeMatchConfidence,
  needsAiTiebreak,
  scoreProductMatch,
} from '@/lib/product-match';

describe('attr-normalize', () => {
  it('normalizes storage aliases to the same key', () => {
    expect(normalizeStorage('512 GB')).toBe('512gb');
    expect(normalizeStorage('512ГБ')).toBe('512gb');
    expect(normalizeStorage('512 Gb')).toBe('512gb');
    expect(normalizeStorage('0.5 TB')).toBe('512gb');
    expect(normalizeStorage('8+256')).toBe('8+256');
    expect(normalizeStorage('8/256 ГБ')).toBe('8+256');
    expect(extractNormalizedStorage('Смартфон 8 ГБ / 256 ГБ')).toBe('8+256');
  });

  it('normalizes color aliases to families', () => {
    expect(normalizeColor('Midnight')).toBe('black');
    expect(normalizeColor('Black')).toBe('black');
    expect(normalizeColor('Черный')).toBe('black');
    expect(normalizeColor('Чёрный')).toBe('black');
    expect(normalizeColor('Space Black')).toBe('black');
    expect(extractNormalizedColor('iPhone Space Black 256GB')).toBe('black');
  });

  it('normalizes volume and package count', () => {
    expect(normalizeVolumeMl('1 л')).toBe(1000);
    expect(normalizeVolumeMl('1000 мл')).toBe(1000);
    expect(extractNormalizedVolumeMl('Гель Fairy 1.5 л')).toBe(1500);
    expect(normalizePackageCount('6 шт')).toBe(6);
    expect(normalizePackageCount('уп. 12')).toBe(12);
    expect(extractNormalizedPackageCount('Салфетки 24 шт в уп')).toBe(24);
  });

  it('normalizes connector aliases to canonical values', () => {
    expect(normalizeConnector('USB-C')).toBe('usb-c');
    expect(normalizeConnector('Type C')).toBe('usb-c');
    expect(normalizeConnector('Lightning')).toBe('lightning');
    expect(normalizeConnector('3.5 мм')).toBe('3.5mm');
    expect(normalizeConnector('mini-jack')).toBe('3.5mm');
    expect(normalizeConnector('USB A')).toBe('usb-a');
    expect(
      extractNormalizedConnector('Apple AirPods Pro 2 USB-C с зарядным кейсом'),
    ).toBe('usb-c');
  });
});

describe('match-category', () => {
  it('exposes profiles for 5+ categories and generic', () => {
    const keys = Object.keys(MATCH_PROFILES);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(MATCH_PROFILES.smartphones).toBeTruthy();
    expect(MATCH_PROFILES.cameras).toBeTruthy();
    expect(MATCH_PROFILES.consoles).toBeTruthy();
    expect(MATCH_PROFILES.apparel).toBeTruthy();
    expect(MATCH_PROFILES.detergents).toBeTruthy();
    expect(MATCH_PROFILES.generic).toBeTruthy();
  });

  it('infers categories from titles', () => {
    expect(inferProductCategory('Смартфон Xiaomi Redmi 15C 8/256')).toBe('smartphones');
    expect(inferProductCategory('Ноутбук ASUS 15.6"')).toBe('laptops');
    expect(inferProductCategory('Apple AirPods Max')).toBe('headphones');
    expect(inferProductCategory('Фотоаппарат Nikon D810')).toBe('cameras');
    expect(inferProductCategory('Объектив Canon EF 50mm')).toBe('lenses');
    expect(inferProductCategory('PlayStation 5')).toBe('consoles');
    expect(inferProductCategory('Футболка Nike мужская M')).toBe('apparel');
    expect(inferProductCategory('Кроссовки Adidas Runfalcon')).toBe('shoes');
    expect(inferProductCategory('Стиральный порошок Persil 3 кг')).toBe('detergents');
  });
});

describe('category-aware product match', () => {
  it('smartphone: same model different memory → low score', () => {
    const score = computeMatchConfidence(
      'Смартфон Xiaomi Redmi Note 14 8/256 ГБ чёрный',
      'Смартфон Xiaomi Redmi Note 14 8/128 ГБ чёрный',
    );
    expect(score).toBeLessThan(55);
  });

  it('apparel: same tee M vs L → high same-model (size soft)', () => {
    const score = computeMatchConfidence(
      'Футболка Nike Dri-FIT мужская чёрная размер M',
      'Футболка Nike Dri-FIT мужская черная размер L',
    );
    expect(score).toBeGreaterThanOrEqual(AUTO_PICK_CONFIDENCE_THRESHOLD);
  });

  it('detergent: brand + volume + pack align', () => {
    const score = computeMatchConfidence(
      'Гель для стирки Persil Color 1.3 л',
      'Persil Color гель 1300 мл',
    );
    expect(score).toBeGreaterThanOrEqual(55);
  });

  it('keeps AirPods / brand rejection regressions', () => {
    expect(
      computeMatchConfidence(
        'Apple AirPods Max серебристый',
        'Наушники Apple AirPods Max Silver',
      ),
    ).toBeGreaterThan(50);

    expect(
      computeMatchConfidence(
        'Смартфон Redmi Note 14S Blue 8G+128G',
        'realme Смартфон 16 5G 8/256 ГБ',
      ),
    ).toBeLessThan(52);
  });

  it('needsAiTiebreak stub for ambiguous band', () => {
    expect(needsAiTiebreak(80)).toBe(true);
    expect(needsAiTiebreak(92)).toBe(false);
    expect(needsAiTiebreak(72, 70)).toBe(true);
  });

  it('scoreProductMatch API accepts optional category', () => {
    const a = scoreProductMatch(
      'Футболка Adidas Originals белая M',
      'Футболка Adidas Originals белая L',
      undefined,
      'apparel',
    );
    expect(a).toBeGreaterThan(0.55);
  });
});
