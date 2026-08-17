import { describe, expect, it } from 'vitest';
import { isUnambiguousSerpTop, tryUnambiguousSerpVerified } from '@/lib/serp-auto-pick';

describe('serp-auto-pick', () => {
  it('accepts clear top-1 with AUTO_PICK + product URL + price', () => {
    expect(
      isUnambiguousSerpTop([
        {
          title: 'Google Pixel 8',
          url: 'https://market.yandex.ru/card/pixel-8/1',
          price: 42000,
          confidence: 86,
        },
      ]),
    ).toBe(true);
  });

  it('rejects close ties of two strong candidates', () => {
    expect(
      isUnambiguousSerpTop([
        {
          title: 'Pixel 8 A',
          url: 'https://www.ozon.ru/product/a/',
          price: 42000,
          confidence: 92,
        },
        {
          title: 'Pixel 8 B',
          url: 'https://www.ozon.ru/product/b/',
          price: 41000,
          confidence: 90,
        },
      ]),
    ).toBe(false);
  });

  it('rejects search-page URLs', () => {
    expect(
      tryUnambiguousSerpVerified('ozon', [
        {
          title: 'Pixel',
          url: 'https://www.ozon.ru/search/?text=pixel',
          price: 100,
          confidence: 99,
        },
      ]),
    ).toBeNull();
  });
});
