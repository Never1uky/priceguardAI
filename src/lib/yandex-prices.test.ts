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
});
