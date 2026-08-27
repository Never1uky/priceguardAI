/**
 * Session counters for empty HiddenBrowser scrapes.
 * Card: fail-fast to Edge unlocker after N empties.
 * SERP: after N empties in the same research, stop opening more SERP tabs for that MP
 * (e.g. skip HiddenBrowser SERP when the visible tab already returned empty).
 */
import type { ComparisonMarketplace } from '@/types/comparison';
import { COMPARISON_MARKETPLACE_IDS } from '@/lib/marketplaces/registry';

export type EmptyScrapeKind = 'serp' | 'card';

const emptyCounts = new Map<string, number>();

const ALL_MARKETPLACES: ComparisonMarketplace[] = [...COMPARISON_MARKETPLACE_IDS];

/** After this many empty SERPs for an MP in the current research → skip further SERP tabs. */
export const SERP_EMPTY_SKIP_THRESHOLD = 1;
/** After this many empty card scrapes → skip HiddenBrowser card for that MP. */
export const CARD_EMPTY_SKIP_THRESHOLD = 2;

function key(marketplace: ComparisonMarketplace, kind: EmptyScrapeKind): string {
  return `${marketplace}:${kind}`;
}

function thresholdFor(kind: EmptyScrapeKind): number {
  return kind === 'serp' ? SERP_EMPTY_SKIP_THRESHOLD : CARD_EMPTY_SKIP_THRESHOLD;
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
 * Skip HiddenBrowser / SERP tabs when the empty budget for this kind is exhausted.
 * Counters reset at research start (`resetAllEmptyScrapes`).
 */
export function shouldSkipTabScrape(
  marketplace: ComparisonMarketplace,
  kind: EmptyScrapeKind = 'serp',
): boolean {
  return (emptyCounts.get(key(marketplace, kind)) ?? 0) >= thresholdFor(kind);
}

export function getEmptyScrapeCount(
  marketplace: ComparisonMarketplace,
  kind: EmptyScrapeKind = 'serp',
): number {
  return emptyCounts.get(key(marketplace, kind)) ?? 0;
}
