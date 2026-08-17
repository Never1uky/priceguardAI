/**
 * Session counters for empty HiddenBrowser scrapes → fail-fast to Edge unlocker.
 * Card and SERP scrapes are tracked separately so cascade card fails do not skip SERP tabs.
 */
import type { ComparisonMarketplace } from '@/types/comparison';

export type EmptyScrapeKind = 'serp' | 'card';

const emptyCounts = new Map<string, number>();

const ALL_MARKETPLACES: ComparisonMarketplace[] = [
  'wildberries',
  'ozon',
  'yandex_market',
];

function key(marketplace: ComparisonMarketplace, kind: EmptyScrapeKind): string {
  return `${marketplace}:${kind}`;
}

export function noteEmptyScrape(
  marketplace: ComparisonMarketplace,
  kind: EmptyScrapeKind = 'serp',
): number {
  const k = key(marketplace, kind);
  const next = (emptyCounts.get(k) ?? 0) + 1;
  emptyCounts.set(k, next);
  return next;
}

export function resetEmptyScrape(
  marketplace: ComparisonMarketplace,
  kind: EmptyScrapeKind = 'serp',
): void {
  emptyCounts.set(key(marketplace, kind), 0);
}

/** Reset serp + card budgets (call on «Найти заново» / research). */
export function resetAllEmptyScrapes(marketplace?: ComparisonMarketplace): void {
  const list = marketplace ? [marketplace] : ALL_MARKETPLACES;
  for (const mp of list) {
    resetEmptyScrape(mp, 'serp');
    resetEmptyScrape(mp, 'card');
  }
}

/**
 * Skip HiddenBrowser only for exhausted **card** scrapes.
 * SERP must always be attempted (visible tab / HiddenBrowser) — a session-wide
 * skip after 2 empty SERPs left WB/YM on dead search APIs for the rest of SW life.
 */
export function shouldSkipTabScrape(
  marketplace: ComparisonMarketplace,
  kind: EmptyScrapeKind = 'serp',
): boolean {
  if (kind === 'serp') return false;
  return (emptyCounts.get(key(marketplace, kind)) ?? 0) >= 2;
}
