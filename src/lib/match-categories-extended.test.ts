import { describe, expect, it } from 'vitest';
import { inferProductCategory } from '@/lib/match-category';
import { extractProductModel, stripCategoryQueryNoise } from '@/lib/model-extract';
import { computeMatchConfidence } from '@/lib/product-match';

describe('extended match categories', () => {
  it('infers lenses before cameras', () => {
    expect(inferProductCategory('Объектив Canon EF 50mm f/1.8 STM')).toBe('lenses');
    expect(inferProductCategory('Фотоаппарат Canon EOS 650D')).toBe('cameras');
  });

  it('infers consoles, power tools, appliances', () => {
    expect(inferProductCategory('Игровая приставка Sony PlayStation 5')).toBe('consoles');
    expect(inferProductCategory('Дрель Bosch GSB 13 RE')).toBe('power_tools');
    expect(inferProductCategory('Стиральная машина Samsung WW80T554DAW')).toBe('appliances');
  });

  it('stripCategoryQueryNoise removes category filler words', () => {
    expect(stripCategoryQueryNoise('consoles', 'PlayStation 5 игровая приставка')).toMatch(
      /playstation\s*5/i,
    );
    expect(stripCategoryQueryNoise('power_tools', 'Дрель Bosch GSB 13 RE')).toMatch(/bosch/i);
    expect(stripCategoryQueryNoise('appliances', 'Стиральная машина Samsung WW80')).toMatch(
      /samsung/i,
    );
  });

  it('extracts console and tool models', () => {
    expect(extractProductModel('Sony PlayStation 5').model.toLowerCase()).toMatch(/playstation|ps/);
    expect(extractProductModel('Bosch GSB 13 RE').model.toLowerCase()).toMatch(/gsb|bosch/);
  });

  it('console: PS5 vs PS4 lower match', () => {
    const ref = 'Sony PlayStation 5 Digital Edition';
    const same = computeMatchConfidence(ref, 'PlayStation 5 PS5');
    const diff = computeMatchConfidence(ref, 'Sony PlayStation 4 Slim');
    expect(same).toBeGreaterThan(diff);
  });

  it('regression: smartphone scores unchanged band', () => {
    const high = computeMatchConfidence(
      'Смартфон Xiaomi Redmi Note 14 8/256 ГБ чёрный',
      'Xiaomi Redmi Note 14 8/256 черный',
    );
    const low = computeMatchConfidence(
      'Смартфон Redmi Note 14S Blue 8G+128G',
      'realme Смартфон 16 5G 8/256 ГБ',
    );
    expect(high).toBeGreaterThan(55);
    expect(low).toBeLessThan(52);
  });
});
