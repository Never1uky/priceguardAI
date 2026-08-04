import { describe, expect, it } from 'vitest';
import {
  noteEmptyScrape,
  resetAllEmptyScrapes,
  resetEmptyScrape,
  shouldSkipTabScrape,
} from '@/lib/empty-scrape-guard';

describe('empty-scrape-guard', () => {
  it('tracks card and serp buckets separately', () => {
    resetEmptyScrape('ozon', 'serp');
    resetEmptyScrape('ozon', 'card');

    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'card');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(true);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);

    noteEmptyScrape('ozon', 'serp');
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);
    noteEmptyScrape('ozon', 'serp');
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(true);
  });

  it('resetAllEmptyScrapes clears both buckets', () => {
    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'card');
    noteEmptyScrape('ozon', 'serp');
    noteEmptyScrape('ozon', 'serp');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(true);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(true);

    resetAllEmptyScrapes('ozon');
    expect(shouldSkipTabScrape('ozon', 'card')).toBe(false);
    expect(shouldSkipTabScrape('ozon', 'serp')).toBe(false);
  });
});
