import { describe, expect, it } from 'vitest';
import { inferProductCategory } from '@/lib/match-category';
import {
  DEFAULT_MIN_MATCH_SCORE,
  scoreProductMatch,
} from '@/lib/product-match';

const MONOBLOCK =
  '23.8" Моноблок CHUWI Unitech 24 Full HD, AMD Ryzen 5 6600H, 16ГБ DDR5, 512ГБ SSD';

describe('monoblock vs mini-PC / components', () => {
  it('infers monoblocks / desktops(mini-PC) / pc_components / laptops', () => {
    expect(inferProductCategory(MONOBLOCK)).toBe('monoblocks');
    expect(inferProductCategory('Мини-ПК MQ AMD Ryzen 5 6600H 16ГБ')).toBe('desktops');
    expect(inferProductCategory('Оперативная память DDR5 16ГБ Kingston')).toBe('pc_components');
    expect(inferProductCategory('Накопитель SSD 512ГБ Samsung')).toBe('pc_components');
    expect(
      inferProductCategory('Игровой ноутбук ASUS TUF Ryzen 5 6600H 16ГБ 512ГБ SSD'),
    ).toBe('laptops');
  });

  it('rejects mini-PC and RAM against monoblock reference', () => {
    expect(scoreProductMatch(MONOBLOCK, 'Мини-ПК MQ AMD Ryzen 5 6600H')).toBe(0);
    expect(scoreProductMatch(MONOBLOCK, 'Оперативная память DDR5 16ГБ')).toBe(0);
    expect(scoreProductMatch(MONOBLOCK, 'Видеокарта RTX 3050 8GB')).toBe(0);
  });

  it('rejects components against laptop; accepts another laptop', () => {
    const laptop = 'Игровой ноутбук ASUS TUF Ryzen 5 6600H 16ГБ 512ГБ';
    expect(scoreProductMatch(laptop, 'Накопитель SSD 512ГБ Samsung')).toBe(0);
    expect(
      scoreProductMatch(laptop, 'Игровой ноутбук ASUS TUF Ryzen 5 6600H 16ГБ 512ГБ SSD'),
    ).toBeGreaterThanOrEqual(DEFAULT_MIN_MATCH_SCORE);
  });

  it('same monoblock still matches', () => {
    expect(
      scoreProductMatch(
        MONOBLOCK,
        'Моноблок CHUWI Unitech 24 Ryzen 5 6600H 16ГБ 512ГБ SSD',
      ),
    ).toBeGreaterThanOrEqual(DEFAULT_MIN_MATCH_SCORE);
  });
});
