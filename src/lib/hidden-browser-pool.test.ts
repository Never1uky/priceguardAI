import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HIDDEN_BROWSER_POOL_SIZE,
  __resetHiddenBrowserForTests,
  acquireHiddenBrowser,
  closeHiddenBrowser,
  getHiddenBrowserUserCount,
  isHiddenBrowserTab,
  releaseHiddenBrowser,
} from '@/lib/hidden-browser';

/**
 * Perf fix regression tests: marketplace-search.ts already dispatches target-
 * marketplace searches in parallel (Promise.all), but they used to all funnel
 * through one shared HiddenBrowser instance, re-serializing what looked
 * parallel at the call site. This tests the pool allocation logic itself —
 * real chrome.windows navigation isn't exercised here (no live browser in
 * this environment), only which HiddenBrowser instance gets handed out.
 */
describe('hidden-browser pool', () => {
  afterEach(() => {
    __resetHiddenBrowserForTests();
    vi.unstubAllGlobals();
  });

  it('pool size constant is > 1 (the whole point of this change)', () => {
    expect(HIDDEN_BROWSER_POOL_SIZE).toBeGreaterThan(1);
  });

  it('first acquire creates a session; concurrent second acquire gets a DIFFERENT instance', () => {
    const first = acquireHiddenBrowser();
    const second = acquireHiddenBrowser();
    expect(second).not.toBe(first);
    expect(getHiddenBrowserUserCount()).toBe(2);
  });

  it('does not grow the pool past HIDDEN_BROWSER_POOL_SIZE — extra concurrent callers share the least-busy slot', () => {
    const acquired = Array.from({ length: HIDDEN_BROWSER_POOL_SIZE + 3 }, () => acquireHiddenBrowser());
    const unique = new Set(acquired);
    expect(unique.size).toBeLessThanOrEqual(HIDDEN_BROWSER_POOL_SIZE);
    expect(getHiddenBrowserUserCount()).toBe(HIDDEN_BROWSER_POOL_SIZE + 3);
  });

  it('releasing the correct instance frees only that slot — a fresh acquire reuses the idle one', () => {
    const first = acquireHiddenBrowser();
    const second = acquireHiddenBrowser();
    expect(second).not.toBe(first);

    void releaseHiddenBrowser(first);
    expect(getHiddenBrowserUserCount()).toBe(1);

    // With `first`'s slot idle and `second`'s slot still busy, the next
    // acquire must reuse the idle slot (same instance as `first`), not grow
    // the pool or share the busy one.
    const third = acquireHiddenBrowser();
    expect(third).toBe(first);
    expect(getHiddenBrowserUserCount()).toBe(2);
  });

  it('release without an instance argument (legacy call pattern) still decrements a slot, not a crash', async () => {
    acquireHiddenBrowser();
    expect(getHiddenBrowserUserCount()).toBe(1);
    await releaseHiddenBrowser();
    expect(getHiddenBrowserUserCount()).toBe(0);
  });

  it('isHiddenBrowserTab recognizes tabs/windows belonging to ANY pool slot, not just the first', async () => {
    vi.stubGlobal('chrome', {
      windows: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 111, tabs: [{ id: 1111 }] })
          .mockResolvedValueOnce({ id: 222, tabs: [{ id: 2222 }] }),
      },
    });

    const first = acquireHiddenBrowser();
    const second = acquireHiddenBrowser();
    expect(second).not.toBe(first);

    await first.runExclusive((nav) => nav('https://example.com/a'));
    await second.runExclusive((nav) => nav('https://example.com/b'));

    // Both pool sessions' tab/window ids must be recognized — not just slot 0.
    expect(isHiddenBrowserTab(1111, undefined)).toBe(true);
    expect(isHiddenBrowserTab(undefined, 111)).toBe(true);
    expect(isHiddenBrowserTab(2222, undefined)).toBe(true);
    expect(isHiddenBrowserTab(undefined, 222)).toBe(true);
    expect(isHiddenBrowserTab(9999, undefined)).toBe(false);
  });

  it('closeHiddenBrowser closes every pool slot, not just the primary one', async () => {
    vi.stubGlobal('chrome', {
      windows: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 111, tabs: [{ id: 1111 }] })
          .mockResolvedValueOnce({ id: 222, tabs: [{ id: 2222 }] }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    });

    const first = acquireHiddenBrowser();
    const second = acquireHiddenBrowser();
    await first.runExclusive((nav) => nav('https://example.com/a'));
    await second.runExclusive((nav) => nav('https://example.com/b'));

    await closeHiddenBrowser();

    expect(isHiddenBrowserTab(1111, undefined)).toBe(false);
    expect(isHiddenBrowserTab(2222, undefined)).toBe(false);
    expect(getHiddenBrowserUserCount()).toBe(0);
  });
});
