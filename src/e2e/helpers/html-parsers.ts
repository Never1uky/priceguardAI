/**
 * Лёгкие парсеры для E2E-фикстур (без jsdom).
 * Дублируют ключевую логику, которую content script применяет к DOM.
 */

/** Извлечь цену из текста карточки WB (рубли) */
export function parseRubFromFixture(text: string): number | null {
  const match = text.match(/(\d[\d\s]*)\s*₽/);
  if (!match) return null;
  return parseInt(match[1].replace(/\s/g, ''), 10) || null;
}

/** Рейтинг и количество оценок из HTML-фикстуры */
export function parseRatingFromFixture(html: string): {
  rating: number | null;
  reviewCount: number | null;
} {
  const ratingMatch = html.match(/address-rate-mini[^>]*>(\d[.,]\d)/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;

  const reviewMatch = html.match(/(\d[\d\s]*)\s*оцен/i);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, ''), 10) : null;

  return { rating, reviewCount };
}

/** Данные из встроенного JSON WB (__WB_STATE__) */
export function parseEmbeddedWbState(html: string): {
  title: string;
  price: number;
  oldPrice?: number;
  rating?: number;
  feedbacks?: number;
} | null {
  const stateMatch = html.match(/__WB_STATE__\s*=\s*(\{[^}]+\})/);
  if (!stateMatch) return null;

  try {
    const state = JSON.parse(stateMatch[1]) as {
      imt_name?: string;
      brand?: string;
      salePriceU?: number;
      priceU?: number;
      reviewRating?: number;
      feedbacks?: number;
    };

    const normalizeKopecks = (v?: number) => (v && v >= 1000 ? Math.round(v / 100) : v ?? 0);
    const sale = normalizeKopecks(state.salePriceU);
    const basic = normalizeKopecks(state.priceU);
    const price = sale || basic;
    if (!price) return null;

    const brand = state.brand?.trim() ?? '';
    const name = state.imt_name?.trim() ?? '';
    const title = brand && name ? `${brand} ${name}` : name || brand;

    return {
      title,
      price,
      oldPrice: basic > price ? basic : undefined,
      rating: state.reviewRating,
      feedbacks: state.feedbacks,
    };
  } catch {
    return null;
  }
}
