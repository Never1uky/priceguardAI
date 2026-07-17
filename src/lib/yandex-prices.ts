/**
 * Разбор цен Яндекс.Маркета: базовая / Пэй / зачёркнутая.
 * На карточке крупная зелёная цена часто «с Пэй» — для сравнения предпочитаем basePrice, если есть.
 */

export interface YandexPriceBreakdown {
  /** Цена для сравнения и алертов (предпочтительно без Пэй) */
  price: number;
  basePrice?: number;
  payPrice?: number;
  oldPrice?: number;
}

const PAY_HINT = /п[еэ]й|pay|ya\.?pay|яндекс.?п[еэ]й/i;

function parseRubNumbers(text: string): number[] {
  return [...text.replace(/\u00a0/g, ' ').matchAll(/(\d[\d\s]*)\s*(?:₽|руб)/gi)]
    .map((m) => parseInt(m[1].replace(/\s/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n >= 50 && n < 50_000_000);
}

/**
 * Из текста ценового блока (DOM) вытащить base / pay / old.
 */
export function parseYandexPriceBlockText(blockText: string): YandexPriceBreakdown | null {
  const text = blockText.replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  const all = parseRubNumbers(text);
  if (!all.length) return null;

  const unique = [...new Set(all)].sort((a, b) => a - b);
  const minAll = unique[0]!;
  const maxAll = unique[unique.length - 1]!;
  const hasPayLabel = PAY_HINT.test(text);
  const hasDiscountBadge = /(?:−|-|–)\s*\d{1,2}\s*%/.test(text);

  let oldPrice: number | undefined;
  // Зачёркнутая обычно с бейджем скидки; иначе max может быть просто «по карте»
  if (unique.length >= 2 && hasDiscountBadge && maxAll > minAll * 1.05) {
    oldPrice = maxAll;
  } else if (unique.length >= 3 && maxAll > minAll * 1.12) {
    oldPrice = maxAll;
  }

  const working = oldPrice ? unique.filter((p) => p < oldPrice! * 0.98) : unique;
  if (!working.length) working.push(minAll);

  // Явный «Пэй» у блока: меньшая цена = Pay; если есть ещё одна — base
  if (hasPayLabel) {
    const payPrice = Math.min(...working);
    const nonPay = working.filter((p) => Math.abs(p - payPrice) / payPrice > 0.01);
    const basePrice = nonPay.length ? Math.max(...nonPay) : undefined;
    return {
      price: basePrice ?? payPrice,
      basePrice,
      payPrice,
      oldPrice: oldPrice && oldPrice > (basePrice ?? payPrice) ? oldPrice : undefined,
    };
  }

  // Без маркера: два близких уровня (4–35%) → низкий Pay, высокий карта
  if (working.length >= 2) {
    const low = Math.min(...working);
    const high = Math.max(...working);
    const ratio = high / low;
    if (ratio >= 1.04 && ratio <= 1.35) {
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
export function yandexBreakdownToOfferPrices(
  breakdown: YandexPriceBreakdown,
): Pick<YandexPriceBreakdown, 'price' | 'basePrice' | 'payPrice' | 'oldPrice'> {
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
