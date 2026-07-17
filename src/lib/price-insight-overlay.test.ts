import { describe, expect, it } from 'vitest';
import { buildPriceInsightOverlay } from '@/lib/price-insight-overlay';

describe('buildPriceInsightOverlay', () => {
  it('mentions current price and cheaper marketplace', () => {
    const text = buildPriceInsightOverlay({
      productPrice: 10_000,
      oldPrice: 12_000,
      priceHistory: [
        { price: 9_000, date: '01.01.2026' },
        { price: 10_000, date: '10.01.2026' },
      ],
      compareOffers: [{ marketplace: 'ozon', price: 8_500 }],
    });
    expect(text).toContain('10000');
    expect(text).toContain('Скидка');
    expect(text).toContain('ozon');
    expect(text).toContain('8500');
  });
});
