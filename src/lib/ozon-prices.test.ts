import {
  ozonBreakdownToOfferPrices,
  ozonPricesFromNumbers,
  parseOzonPriceBlockText,
} from '@/lib/ozon-prices';
import { describe, expect, it } from 'vitest';

describe('ozon prices', () => {
  it('splits bank vs other banks vs strikethrough', () => {
    const text = '15 830 ₽ С банками 15 990 ₽ С другими банками 17 999 ₽';
    const prices = ozonBreakdownToOfferPrices(parseOzonPriceBlockText(text)!);
    expect(prices.payPrice).toBe(15_830);
    expect(prices.basePrice).toBe(15_990);
    expect(prices.price).toBe(15_990);
    expect(prices.oldPrice).toBe(17_999);
  });

  it('single price stays as base', () => {
    const prices = ozonBreakdownToOfferPrices(parseOzonPriceBlockText('4 990 ₽')!);
    expect(prices.price).toBe(4_990);
    expect(prices.basePrice).toBe(4_990);
    expect(prices.payPrice).toBeUndefined();
  });

  it('numbers: close pair → base + bank', () => {
    const prices = ozonBreakdownToOfferPrices(ozonPricesFromNumbers([15_830, 15_990])!);
    expect(prices.payPrice).toBe(15_830);
    expect(prices.basePrice).toBe(15_990);
    expect(prices.price).toBe(15_990);
  });

  it('numbers: three levels → bank + base + old', () => {
    const prices = ozonBreakdownToOfferPrices(
      ozonPricesFromNumbers([15_830, 15_990, 17_999])!,
    );
    expect(prices.payPrice).toBe(15_830);
    expect(prices.basePrice).toBe(15_990);
    expect(prices.oldPrice).toBe(17_999);
  });
});
