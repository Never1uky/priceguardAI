import { describe, expect, it } from 'vitest';
import {
  isGenericOzonTitle,
  isGenericProductTitle,
  preferRealTitle,
} from '@/utils/wb-image';

describe('isGenericProductTitle', () => {
  it('flags marketplace placeholders', () => {
    expect(isGenericOzonTitle('Товар на Ozon')).toBe(true);
    expect(isGenericProductTitle('Товар на Ozon')).toBe(true);
    expect(isGenericProductTitle('Товар на Яндекс.Маркет')).toBe(true);
    expect(isGenericProductTitle('Товар на Wildberries')).toBe(true);
    expect(isGenericProductTitle('Товар')).toBe(true);
  });

  it('keeps real titles', () => {
    expect(isGenericProductTitle('Apple AirPods Max Midnight')).toBe(false);
    expect(preferRealTitle('Товар на Ozon', 'Apple AirPods Max')).toBe('Apple AirPods Max');
    expect(preferRealTitle('Apple AirPods Max', 'Товар на Ozon')).toBe('Apple AirPods Max');
  });
});
