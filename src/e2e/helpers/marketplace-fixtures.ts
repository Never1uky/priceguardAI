/**
 * Парсеры фикстур Ozon / Яндекс.Маркет (офлайн E2E).
 */

/** Парсинг цены и рейтинга из HTML-фикстуры Ozon */
export function parseOzonFixture(html: string): {
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  isOriginal: boolean;
} {
  const priceMatch = html.match(/(\d[\d\s]*)\s*₽/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g, ''), 10) : null;

  const ratingMatch = html.match(/>(\d[.,]\d)</);
  const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;

  const reviewMatch = html.match(/(\d[\d\s]*)\s*отзыв/i);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, ''), 10) : null;

  const isOriginal = /оригинал/i.test(html);

  return { price, rating, reviewCount, isOriginal };
}

/** Парсинг цены и рейтинга из HTML-фикстуры Яндекс.Маркет */
export function parseYmFixture(html: string): {
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
} {
  const priceMatch = html.match(/(\d[\d\s]*)\s*₽/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g, ''), 10) : null;

  const ratingMatch = html.match(/(\d[.,]\d)\s*из\s*5/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;

  const reviewMatch = html.match(/(\d[\d\s]*)\s*отзыв/i);
  const reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, ''), 10) : null;

  return { price, rating, reviewCount };
}
