import type { PricePoint } from '@/types/product';
import {
  analyzePriceHistory,
  FAKE_DISCOUNT_MIN_HISTORY,
  strikethroughSeenInHistory,
} from '@/lib/price-insights';
import { describe, expect, it } from 'vitest';

function hist(...prices: number[]): PricePoint[] {
  return prices.map((price, i) => ({ price, timestamp: i * 1000 }));
}

describe('analyzePriceHistory fake discount', () => {
  it('short history → unconfirmed strikethrough, not fake', () => {
    const insight = analyzePriceHistory(hist(215_609), 215_609, 277_490);
    expect(insight.kind).toBe('unconfirmed_strikethrough');
    expect(insight.label).toBe('Скидка не подтверждена историей');
    expect(insight.detail).toMatch(/рано судить|проверк/i);
    expect(insight.label).not.toMatch(/зачёркнутая/i);
    expect(insight.detail).not.toMatch(/зачёркнутая/i);
  });

  it('long history without strike → fake_discount', () => {
    const prices = [210_000, 215_609, 212_000, 214_000, 215_609, 213_000];
    expect(prices.length).toBeGreaterThanOrEqual(FAKE_DISCOUNT_MIN_HISTORY);
    const insight = analyzePriceHistory(hist(...prices), 215_609, 277_490);
    expect(insight.kind).toBe('fake_discount');
    expect(insight.detail).toMatch(/до скидки/i);
    expect(insight.detail).not.toMatch(/зачёркнутая/i);
  });

  it('strike seen in history (±2%) → not fake', () => {
    const insight = analyzePriceHistory(
      hist(200_000, 277_000, 210_000, 215_000, 212_000, 214_000),
      210_000,
      277_490,
    );
    expect(insight.kind).not.toBe('fake_discount');
    expect(insight.kind).not.toBe('unconfirmed_strikethrough');
  });

  it('strikethroughSeenInHistory tolerance', () => {
    expect(strikethroughSeenInHistory(hist(277_000), 277_490)).toBe(true);
    expect(strikethroughSeenInHistory(hist(215_609), 277_490)).toBe(false);
  });
});
