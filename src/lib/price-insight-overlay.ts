/**
 * Client-side priceInsight из уже собранных данных (без AI).
 * Static-анализ (pros/verdict) не трогаем — только динамический overlay.
 */

export interface PriceInsightInput {
  productPrice: number;
  oldPrice?: number;
  priceHistory?: Array<{ price: number; date: string }>;
  compareOffers?: Array<{
    marketplace: string;
    price: number | null;
    rating?: number | null;
    title?: string;
  }>;
}

export function buildPriceInsightOverlay(input: PriceInsightInput): string {
  let priceInsight = `Текущая цена ${input.productPrice} ₽.`;

  if (input.oldPrice && input.oldPrice > input.productPrice) {
    const discount = Math.round((1 - input.productPrice / input.oldPrice) * 100);
    priceInsight += ` Скидка ${discount}% — проверьте историю цен.`;
  }

  if (input.priceHistory && input.priceHistory.length >= 2) {
    const prices = input.priceHistory.map((p) => p.price);
    const min = Math.min(...prices);
    if (input.productPrice > min * 1.05) {
      priceInsight += ` Минимальная цена в истории: ${min} ₽ — возможно, стоит подождать.`;
    } else if (input.productPrice <= min) {
      priceInsight += ' Цена на минимуме за отслеживаемый период.';
    }
  }

  if (input.compareOffers?.length) {
    const validPrices = input.compareOffers.filter((o) => o.price && o.price > 0);
    if (validPrices.length) {
      const cheapest = validPrices.reduce((a, b) => (a.price! < b.price! ? a : b));
      if (cheapest.price! < input.productPrice) {
        priceInsight += ` Дешевле на ${cheapest.marketplace}: ${cheapest.price} ₽.`;
      }
    }
  }

  return priceInsight;
}

export function withPriceInsightOverlay<T extends { priceInsight: string }>(
  analysis: T,
  input: PriceInsightInput,
): T {
  return {
    ...analysis,
    priceInsight: buildPriceInsightOverlay(input),
  };
}
