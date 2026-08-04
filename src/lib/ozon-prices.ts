/**
 * Разбор цен Ozon: «с банками» (Ozon Bank / партнёры) vs «с другими банками» vs зачёркнутая.
 * Для сравнения предпочитаем basePrice (без банк-скидки).
 */

import {
  dropLikelyPackUnitPrices,
  parseListingRubNumbers,
} from '@/lib/listing-rub-prices';

export interface OzonPriceBreakdown {
  /** Цена для сравнения и алертов (без банк-скидки) */
  price: number;
  basePrice?: number;
  /** Цена «с банками» / Ozon Bank */
  payPrice?: number;
  oldPrice?: number;
}

const BANK_HINT = /с\s+банками|ozon\s*банк|озон\s*банк|card\s*price|по\s+карте\s+ozon|с\s+картой\s+ozon/i;
const OTHER_BANKS_HINT = /с\s+другими\s+банками|другими\s+банками/i;

/**
 * Из текста ценового блока (DOM) вытащить base / bank / old.
 */
export function parseOzonPriceBlockText(blockText: string): OzonPriceBreakdown | null {
  const text = blockText.replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  const all = parseListingRubNumbers(text);
  if (!all.length) return null;

  const unique = [...new Set(all)].sort((a, b) => a - b);
  const minAll = unique[0]!;
  const maxAll = unique[unique.length - 1]!;
  const hasBankLabel = BANK_HINT.test(text);
  const hasOtherBanks = OTHER_BANKS_HINT.test(text);
  const hasDiscountBadge = /(?:−|-|–)\s*\d{1,2}\s*%/.test(text);

  let oldPrice: number | undefined;
  if (unique.length >= 2 && hasDiscountBadge && maxAll > minAll * 1.05) {
    oldPrice = maxAll;
  } else if (unique.length >= 3 && maxAll > minAll * 1.08) {
    oldPrice = maxAll;
  }

  const working = oldPrice ? unique.filter((p) => p < oldPrice! * 0.98) : [...unique];
  if (!working.length) working.push(minAll);

  // Явные «с банками» / «с другими банками»: min = bank, max среди remaining = base
  if (hasBankLabel || hasOtherBanks) {
    const payPrice = Math.min(...working);
    const nonPay = working.filter((p) => Math.abs(p - payPrice) / payPrice > 0.01);
    const basePrice = nonPay.length ? Math.max(...nonPay) : undefined;
    return {
      price: basePrice ?? payPrice,
      basePrice,
      payPrice: basePrice && payPrice < basePrice * 0.99 ? payPrice : payPrice,
      oldPrice: oldPrice && oldPrice > (basePrice ?? payPrice) ? oldPrice : undefined,
    };
  }

  // Без маркера: два близких уровня (1–8%) часто банк vs обычная
  if (working.length >= 2) {
    const low = Math.min(...working);
    const high = Math.max(...working);
    const ratio = high / low;
    if (ratio >= 1.005 && ratio <= 1.08) {
      return {
        price: high,
        basePrice: high,
        payPrice: low,
        oldPrice: oldPrice && oldPrice > high ? oldPrice : undefined,
      };
    }
  }

  const price = Math.min(...working);
  return {
    price,
    basePrice: price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
  };
}

/** Нормализовать breakdown в поля оффера / Product */
export function ozonBreakdownToOfferPrices(
  breakdown: OzonPriceBreakdown,
): Pick<OzonPriceBreakdown, 'price' | 'basePrice' | 'payPrice' | 'oldPrice'> {
  const pay = breakdown.payPrice;
  const base = breakdown.basePrice;
  const price = base ?? pay ?? breakdown.price;
  return {
    price,
    basePrice: base,
    payPrice: pay && pay < price * 0.99 ? pay : pay && !base ? pay : undefined,
    oldPrice: breakdown.oldPrice && breakdown.oldPrice > price ? breakdown.oldPrice : undefined,
  };
}

/**
 * Две+ цены из priceV2 без текста: меньшая = банк, большая среди близких = base, max далеко = old.
 * Отбрасывает вероятную «цену за 1 шт» комплекта (×2…×6 от соседнего уровня).
 */
export function ozonPricesFromNumbers(prices: number[]): OzonPriceBreakdown | null {
  const unique = dropLikelyPackUnitPrices(
    [...new Set(prices.filter((n) => n > 0))].sort((a, b) => a - b),
  );
  if (!unique.length) return null;

  if (unique.length === 1) {
    return { price: unique[0]!, basePrice: unique[0]! };
  }

  const min = unique[0]!;
  const max = unique[unique.length - 1]!;

  if (unique.length >= 3 && max > min * 1.08) {
    const mid = unique.filter((p) => p < max * 0.98);
    const payPrice = Math.min(...mid);
    const basePrice = Math.max(...mid);
    return {
      price: basePrice,
      basePrice,
      payPrice: payPrice < basePrice * 0.99 ? payPrice : undefined,
      oldPrice: max,
    };
  }

  const ratio = max / min;
  if (ratio >= 1.005 && ratio <= 1.08) {
    return {
      price: max,
      basePrice: max,
      payPrice: min,
    };
  }

  return {
    price: min,
    basePrice: min,
    oldPrice: max > min * 1.05 ? max : undefined,
  };
}
