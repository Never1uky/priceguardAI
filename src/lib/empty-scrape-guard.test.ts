import { beforeEach, describe, expect, it } from 'vitest';
import {
  noteEmptyScrape,
  resetAllEmptyScrapes,
  shouldSkipTabScrape,
} from '@/lib/empty-scrape-guard';
import { isTabLoadTimeoutError } from '@/lib/tab-complete';

describe('empty-scrape-guard', () => {
  beforeEach(() => {
    resetAllEmptyScrapes();
  });

  it('tracks card skip separately; SERP never skips', () => {
    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'card');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(true);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);

    noteEmptyScrape('ozon', 'serp');
    noteEmptyScrape('ozon', 'serp');
    noteEmptyScrape('ozon', 'serp');
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);
  });

  it('resetAllEmptyScrapes clears card skip for the next compare job', () => {
    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'card');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(true);

    resetAllEmptyScrapes('ozon');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(false);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);
  });

  it('load-timeout errors are distinguishable so callers skip noteEmptyScrape', () => {
    expect(isTabLoadTimeoutError(new Error('Страница поиска не загрузилась'))).toBe(true);
  });
});
