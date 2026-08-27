/**
 * Run async work over items with a fixed concurrency limit.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}

/**
 * Max simultaneous marketplace resolves (HiddenBrowser / tab SERP).
 * Intentional cost guard: keep ≤2 until HiddenBrowser pool > 1 or a Scrappey semaphore exists.
 * Do not raise to 3–4 without those capacity changes.
 */
export const COMPARE_MARKETPLACE_CONCURRENCY = 2;
