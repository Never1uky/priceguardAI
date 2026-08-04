import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HiddenBrowser,
  __resetHiddenBrowserForTests,
} from '@/lib/hidden-browser';

describe('HiddenBrowser.runExclusive', () => {
  afterEach(() => {
    __resetHiddenBrowserForTests();
    vi.unstubAllGlobals();
  });

  it('runs overlapping exclusive jobs strictly sequentially', async () => {
    const order: string[] = [];
    const browser = new HiddenBrowser();

    // Avoid real chrome APIs — nav is unused in this unit test
    const a = browser.runExclusive(async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 40));
      order.push('a-end');
      return 'a';
    });
    const b = browser.runExclusive(async () => {
      order.push('b-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('b-end');
      return 'b';
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('a');
    expect(rb).toBe('b');
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
