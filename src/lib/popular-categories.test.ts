import { describe, expect, it } from 'vitest';
import { inferProductCategory } from '@/lib/match-category';
import { extractProductModel, stripCategoryQueryNoise } from '@/lib/model-extract';
import { computeMatchConfidence } from '@/lib/product-match';

describe('popular retail categories', () => {
  it('P0: appliances — washing machines, robot vacuums, multicookers', () => {
    expect(inferProductCategory('Стиральная машина Samsung WW80T554DAW')).toBe('appliances');
    expect(inferProductCategory('Робот-пылесос Roborock S8 Pro Ultra')).toBe('appliances');
    expect(inferProductCategory('Мультиварка Redmond RMC-M90')).toBe('appliances');
    expect(inferProductCategory('Стиральный порошок Persil 3 кг')).toBe('detergents');
  });

  it('P0: wearables inferred before smartphones', () => {
    expect(inferProductCategory('Фитнес-браслет Xiaomi Smart Band 9')).toBe('wearables');
    expect(inferProductCategory('Умные часы Amazfit GTR 4')).toBe('wearables');
    expect(inferProductCategory('Смартфон Xiaomi Redmi Note 14')).toBe('smartphones');
  });

  it('P1: home, kids, sports categories', () => {
    expect(inferProductCategory('Комплект постельного белья 1.5 спальный')).toBe('home_textile');
    expect(inferProductCategory('Органайзер для хранения вещей')).toBe('home_goods');
    expect(inferProductCategory('Детская футболка для мальчика 104')).toBe('kids');
    expect(inferProductCategory('Протеин Optimum Nutrition Gold Standard 908 г')).toBe('sports');
  });

  it('apparel/shoes extended infer', () => {
    expect(inferProductCategory('Женское платье миди')).toBe('apparel');
    expect(inferProductCategory('Лонгслив женский')).toBe('apparel');
    expect(inferProductCategory('Кроссовки Nike Air Max 90')).toBe('shoes');
  });

  it('stripQueryNoise keeps model tokens', () => {
    expect(stripCategoryQueryNoise('appliances', 'Робот-пылесос Roborock S8 Pro')).toMatch(/roborock/i);
    expect(stripCategoryQueryNoise('apparel', 'Женское платье миди Zara')).toMatch(/zara/i);
    expect(stripCategoryQueryNoise('wearables', 'Xiaomi Smart Band 9')).toMatch(/xiaomi/i);
  });

  it('MODEL_PATTERNS extract popular SKUs', () => {
    expect(extractProductModel('JBL Tune 770NC').model.toLowerCase()).toMatch(/tune 770/);
    expect(extractProductModel('Roborock S8 Pro Ultra').model.toLowerCase()).toMatch(/roborock|s8/);
    expect(extractProductModel('Redmond RMC-M90').model.toLowerCase()).toMatch(/rmc|redmond/);
    expect(extractProductModel('Amazfit Bip 5').model.toLowerCase()).toMatch(/amazfit|bip/);
  });

  it('appliances: same model scores higher than wrong series', () => {
    const ref = 'Робот-пылесос Roborock S8 Pro Ultra';
    const same = computeMatchConfidence(ref, 'Roborock S8 Pro Ultra белый');
    const diff = computeMatchConfidence(ref, 'Roborock S7 MaxV Ultra');
    expect(same).toBeGreaterThan(diff);
  });

  it('apparel: size mismatch stays soft (cross-market)', () => {
    const ref = 'Платье Zara женское M';
    const otherSize = computeMatchConfidence(ref, 'Платье Zara женское L');
    expect(otherSize).toBeGreaterThan(45);
  });
});
