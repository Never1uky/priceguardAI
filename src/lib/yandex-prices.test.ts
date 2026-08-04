import { parseYandexPriceBlockText, yandexBreakdownToOfferPrices } from '@/lib/yandex-prices';
import { describe, expect, it } from 'vitest';

describe('yandex prices', () => {
  it('detects Pay + strikethrough when card price missing', () => {
    const text = '164 791 ₽ Пэй 216 745 ₽ −24%';
    const raw = parseYandexPriceBlockText(text);
    expect(raw).not.toBeNull();
    const prices = yandexBreakdownToOfferPrices(raw!);
    expect(prices.payPrice).toBe(164_791);
    expect(prices.oldPrice).toBe(216_745);
    // Базовой «по карте» на экране нет — сравниваем по доступной (Pay)
    expect(prices.price).toBe(164_791);
    expect(prices.basePrice).toBeUndefined();
  });

  it('splits card vs Pay when both present', () => {
    const text = '189 990 ₽ по карте 164 791 ₽ Пэй';
    const prices = yandexBreakdownToOfferPrices(parseYandexPriceBlockText(text)!);
    expect(prices.basePrice).toBe(189_990);
    expect(prices.payPrice).toBe(164_791);
    expect(prices.price).toBe(189_990);
  });

  it('single price stays as base', () => {
    const prices = yandexBreakdownToOfferPrices(parseYandexPriceBlockText('89 990 ₽')!);
    expect(prices.price).toBe(89_990);
    expect(prices.basePrice).toBe(89_990);
    expect(prices.payPrice).toBeUndefined();
  });

  it('keeps payPrice when Pay-only (no invented basePrice)', () => {
    const prices = yandexBreakdownToOfferPrices({
      price: 7_055,
      basePrice: undefined,
      payPrice: 7_055,
    });
    expect(prices.price).toBe(7_055);
    expect(prices.basePrice).toBeUndefined();
    expect(prices.payPrice).toBe(7_055);
  });

  it('strips payPrice when wrongly equal to basePrice', () => {
    const prices = yandexBreakdownToOfferPrices({
      price: 7_055,
      basePrice: 7_055,
      payPrice: 7_055,
    });
    expect(prices.payPrice).toBeUndefined();
  });

  it('ignores «за 1 шт» unit price when splitting Pay vs card', () => {
    const text = '1199 ₽ Пэй 1332 ₽ по карте 3446 ₽ 600 ₽ за 1 шт';
    const prices = yandexBreakdownToOfferPrices(parseYandexPriceBlockText(text)!);
    expect(prices.payPrice).toBe(1_199);
    expect(prices.basePrice).toBe(1_332);
    expect(prices.price).toBe(1_332);
    expect(prices.oldPrice).toBe(3_446);
  });

  it('ignores ₽/шт unit price next to Pay', () => {
    const text = '164 791 ₽ Пэй 189 990 ₽ 600 ₽/шт';
    const prices = yandexBreakdownToOfferPrices(parseYandexPriceBlockText(text)!);
    expect(prices.payPrice).toBe(164_791);
    expect(prices.basePrice).toBe(189_990);
    expect(prices.price).toBe(189_990);
  });
});
