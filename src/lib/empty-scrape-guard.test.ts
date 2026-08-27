import { beforeEach, describe, expect, it } from 'vitest';
import {
  noteEmptyScrape,
  resetAllEmptyScrapes,
  shouldSkipTabScrape,
  SERP_EMPTY_SKIP_THRESHOLD,
  CARD_EMPTY_SKIP_THRESHOLD,
} from '@/lib/empty-scrape-guard';
import { isTabLoadTimeoutError } from '@/lib/tab-complete';

describe('empty-scrape-guard', () => {
  beforeEach(() => {
    resetAllEmptyScrapes();
  });

  it('skips card after CARD_EMPTY_SKIP_THRESHOLD empties', () => {
    noteEmptyScrape('ozon', 'card');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(false);
    noteEmptyScrape('ozon', 'card');
    expect(CARD_EMPTY_SKIP_THRESHOLD).toBe(2);
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(true);
  });

  it('skips further SERP after SERP_EMPTY_SKIP_THRESHOLD empties in the same research', () => {
    expect(SERP_EMPTY_SKIP_THRESHOLD).toBe(1);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);
    noteEmptyScrape('ozon', 'serp');
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(true);
    // card budget independent
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(false);
  });

  it('resetAllEmptyScrapes clears card and serp skip for the next compare job', () => {
    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'serp');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(true);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(true);

    resetAllEmptyScrapes('ozon');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(false);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);
  });

  it('load-timeout errors are distinguishable so callers skip noteEmptyScrape', () => {
    expect(isTabLoadTimeoutError(new Error('Страница не загрузилась вовремя'))).toBe(true);
  });
});
