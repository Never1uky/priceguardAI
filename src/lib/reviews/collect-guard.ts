/**
 * Защита от параллельного / повторного сбора отзывов (бесконечные PREVIEW_REVIEWS).
 */

const inFlight = new Map<string, Promise<unknown>>();

function collectKey(marketplace: string, productUrl: string, mode: string): string {
  return `${mode}:${marketplace}:${productUrl.split('?')[0].split('#')[0]}`;
}

/** Один активный сбор на URL; повторные вызовы ждут тот же результат. */
export async function withReviewCollectGuard<T>(
  marketplace: string,
  productUrl: string,
  mode: 'preview' | 'analyze',
  fn: () => Promise<T>,
): Promise<T> {
  const key = collectKey(marketplace, productUrl, mode);
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function isReviewCollectInFlight(
  marketplace: string,
  productUrl: string,
  mode: 'preview' | 'analyze' = 'preview',
): boolean {
  return inFlight.has(collectKey(marketplace, productUrl, mode));
}
