import { describe, expect, it } from 'vitest';
import { inferProductCategory } from '@/lib/match-category';
import {
  DEFAULT_MIN_MATCH_SCORE,
  pickBestMatchWithScore,
  scoreProductMatch,
} from '@/lib/product-match';

const LAPTOP =
  'Игровой ноутбук Machenike Quazar S15 i5-12450H, RTX 3050 4ГБ, 16ГБ, 512ГБ';

describe('laptops vs gpus/desktops hard reject', () => {
  it('infers gpus / desktops / laptops', () => {
    expect(inferProductCategory('Видеокарта RTX 3050 8GB')).toBe('gpus');
    expect(inferProductCategory('Трафарет RTX3050/RTX4050 BGA')).toBe('gpus');
    expect(inferProductCategory('Игровой компьютер Core i7 RTX 3050')).toBe('desktops');
    expect(inferProductCategory(LAPTOP)).toBe('laptops');
  });

  it('rejects GPU / stencil / desktop PC against laptop reference', () => {
    expect(scoreProductMatch(LAPTOP, 'Видеокарта RTX 3050 8GB')).toBe(0);
    expect(scoreProductMatch(LAPTOP, 'Трафарет RTX3050/RTX4050')).toBe(0);
    expect(scoreProductMatch(LAPTOP, 'Игровой компьютер Core i7 (8 ядер) RTX 3050')).toBe(0);
  });

  it('still matches another laptop with RTX 3050', () => {
    const other =
      'Игровой ноутбук Machenike Quazar S15 RTX 3050 16ГБ 512ГБ SSD';
    expect(inferProductCategory(other)).toBe('laptops');
    expect(scoreProductMatch(LAPTOP, other)).toBeGreaterThanOrEqual(DEFAULT_MIN_MATCH_SCORE);
  });

  it('pickBestMatch skips GPU when laptop reference has price', () => {
    const candidates = [
      { title: 'Видеокарта RTX 3050', price: 25000, url: 'https://www.ozon.ru/product/gpu-1/' },
      {
        title: 'Игровой ноутбук Machenike Quazar S15 RTX 3050 16ГБ',
        price: 82000,
        url: 'https://www.ozon.ru/product/laptop-1/',
      },
    ];
    const best = pickBestMatchWithScore(LAPTOP, candidates, (c) => c.title, {
      referencePrice: 85640,
      getPrice: (c) => (c as (typeof candidates)[0]).price,
      getUrl: (c) => (c as (typeof candidates)[0]).url,
    });
    expect(best?.item.title).toMatch(/ноутбук/i);
  });
});
