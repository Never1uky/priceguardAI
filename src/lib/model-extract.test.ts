import { describe, expect, it } from 'vitest';
import { inferProductModel } from '@/lib/model-extract';

describe('inferProductModel', () => {
  it('prefers title Pixel 7 over specs «Google Pixel» without digit', () => {
    const info = inferProductModel(
      'Смартфон Google Pixel 7 8/128Gb Lemongrass',
      'Модель: Google Pixel\nЦвет: светло-желтый',
    );
    expect(info.model.toLowerCase()).toMatch(/pixel\s*7/);
  });
});
