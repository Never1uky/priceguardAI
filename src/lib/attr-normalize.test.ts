import { describe, expect, it } from 'vitest';
import {
  extractNormalizedAuthenticity,
  extractNormalizedColor,
  extractNormalizedCondition,
  extractNormalizedConnector,
  extractNormalizedEdition,
  extractNormalizedPackageCount,
  extractNormalizedRegion,
  extractNormalizedStorage,
  extractNormalizedVolumeMl,
  isNonFunctionalReplicaTitle,
  normalizeAuthenticity,
  normalizeCondition,
  normalizeConnector,
  normalizeColor,
  normalizeEdition,
  normalizePackageCount,
  normalizeRegion,
  normalizeStorage,
  normalizeVolumeMl,
  storageCompatible,
  storageRomCanonical,
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
    expect(storageRomCanonical('12+128')).toBe('128gb');
    expect(storageRomCanonical('128gb')).toBe('128gb');
    expect(storageCompatible('128gb', '12+128')).toBe(true);
    expect(storageCompatible('8+256', '256gb')).toBe(true);
    expect(storageCompatible('128gb', '256gb')).toBe(false);
    expect(storageCompatible('8+128', '12+128')).toBe(true);
  });

  it('normalizes color aliases to families', () => {
    expect(normalizeColor('Midnight')).toBe('black');
    expect(normalizeColor('Black')).toBe('black');
    expect(normalizeColor('Черный')).toBe('black');
    expect(normalizeColor('Чёрный')).toBe('black');
    expect(normalizeColor('Space Black')).toBe('black');
    expect(normalizeColor('Obsidian')).toBe('black');
    expect(normalizeColor('Porcelain')).toBe('white');
    expect(normalizeColor('Indigo')).toBe('purple');
    expect(normalizeColor('Hazel')).toBe('beige');
    expect(extractNormalizedColor('iPhone Space Black 256GB')).toBe('black');
    expect(extractNormalizedColor('Смартфон Google Pixel 10 128GB Obsidian')).toBe('black');
    expect(extractNormalizedColor('Pixel 10 128GB Porcelain')).toBe('white');
    expect(extractNormalizedColor('Pixel 10 Indigo 128GB')).toBe('purple');
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

  it('normalizes condition/authenticity/region/edition markers', () => {
    expect(normalizeCondition('CPO')).toBe('cpo');
    expect(normalizeCondition('восстановленный')).toBe('refurbished');
    expect(normalizeCondition('б/у')).toBe('used');
    expect(normalizeCondition('новый')).toBe('new');

    expect(normalizeAuthenticity('оригинал')).toBe('original');
    expect(normalizeAuthenticity('OEM')).toBe('oem');
    expect(normalizeAuthenticity('совместимый')).toBe('compatible');
    expect(normalizeAuthenticity('аналог')).toBe('analog');
    expect(normalizeAuthenticity('реплика')).toBe('replica');
    expect(normalizeAuthenticity('Муляж телефона Fold8')).toBe('replica');
    expect(normalizeAuthenticity('имитация смартфона')).toBe('replica');
    expect(normalizeAuthenticity('реквизит для фотосъемки')).toBe('replica');
    expect(normalizeAuthenticity('dummy phone mockup')).toBe('replica');
    expect(isNonFunctionalReplicaTitle('Муляж Samsung Galaxy Z Fold8')).toBe(true);
    expect(isNonFunctionalReplicaTitle('Смартфон Xiaomi Redmi 15C 8/256')).toBe(false);

    expect(normalizeRegion('Global Version')).toBe('global');
    expect(normalizeRegion('Ростест')).toBe('ru');
    expect(normalizeRegion('EU')).toBe('eu');
    expect(normalizeRegion('US')).toBe('us');
    expect(normalizeRegion('India')).toBe('in');
    expect(normalizeRegion('eSIM only')).toBe('esim_only');
    expect(normalizeRegion('physical SIM')).toBe('sim_physical');

    expect(normalizeEdition('Disc Edition')).toBe('disc');
    expect(normalizeEdition('Digital edition')).toBe('digital');
    expect(normalizeEdition('kit 18-55')).toBe('kit');
    expect(normalizeEdition('body only')).toBe('body');

    expect(extractNormalizedCondition('iPhone 17 refurbished')).toBe('refurbished');
    expect(extractNormalizedAuthenticity('Аккумулятор OEM для Dyson')).toBe('oem');
    expect(extractNormalizedRegion('iPhone 17 eSIM only')).toBe('esim_only');
    expect(extractNormalizedEdition('PlayStation 5 Digital Edition')).toBe('digital');
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
