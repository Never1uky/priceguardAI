/**
 * Singleflight: один in-flight полный анализ на product key.
 */

const inflight = new Map<string, Promise<unknown>>();

export function analysisSingleflightKey(params: {
  marketplace?: string;
  productId?: string;
  url?: string;
}): string {
  if (params.marketplace && params.productId) {
    return `${params.marketplace}:${params.productId}`;
  }
  return params.url?.split('?')[0] ?? 'unknown';
}

export async function withAnalysisSingleflight<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
