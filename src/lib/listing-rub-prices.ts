/**
 * Суммы «за 1 шт» / «₽/шт» — не listing/bank/Pay цена комплекта.
 * Общий фильтр для Ozon и Я.Маркет (cross-MP parity).
 */

/** Суффикс сразу после «N ₽» / «N руб» */
const UNIT_PRICE_SUFFIX =
  /^\s*(?:\/\s*шт\.?|за\s*(?:1\s*)?шт\.?|за\s*единицу|цена\s*за\s*1(?:\s*шт\.?)?)/i;

/**
 * Извлечь рублёвые суммы из текста ценового блока, пропуская unit-price.
 */
export function parseListingRubNumbers(text: string): number[] {
  const normalized = text.replace(/\u00a0/g, ' ');
  const out: number[] = [];

  for (const m of normalized.matchAll(/(\d[\d\s]*)\s*(?:₽|руб\.?)/gi)) {
    const end = (m.index ?? 0) + m[0].length;
    const after = normalized.slice(end, end + 48);
    if (UNIT_PRICE_SUFFIX.test(after)) continue;

    const n = parseInt(m[1]!.replace(/\s/g, ''), 10);
    if (Number.isFinite(n) && n >= 50 && n < 50_000_000) out.push(n);
  }

  return out;
}

/**
 * Без текста: отбросить min, если он ≈ listing/pack unit ближайшей цены (×2…×6).
 * Bank vs base обычно 1–8%, а не «половина комплекта».
 */
export function dropLikelyPackUnitPrices(sortedUnique: number[]): number[] {
  if (sortedUnique.length < 3) return sortedUnique;

  let prices = [...sortedUnique];
  while (prices.length >= 3) {
    const min = prices[0]!;
    const next = prices[1]!;
    const isPackUnit = [2, 3, 4, 5, 6].some((pack) => {
      const expected = min * pack;
      return Math.abs(expected - next) / next <= 0.08;
    });
    if (!isPackUnit) break;
    prices = prices.slice(1);
  }
  return prices;
}
