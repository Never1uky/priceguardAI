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

describe('hidden-browser pool', () => {
  afterEach(() => {
    __resetHiddenBrowserForTests();
    vi.unstubAllGlobals();
  });

  it('pool size is 1 so SERP and card cascade share one window', () => {
    expect(HIDDEN_BROWSER_POOL_SIZE).toBe(1);
  });

  it('concurrent acquires share the same instance (serialized by runExclusive)', () => {
    const first = acquireHiddenBrowser();
    const second = acquireHiddenBrowser();
    expect(second).toBe(first);
    expect(getHiddenBrowserUserCount()).toBe(2);
  });

  it('does not grow the pool past HIDDEN_BROWSER_POOL_SIZE', () => {
    const acquired = Array.from({ length: HIDDEN_BROWSER_POOL_SIZE + 3 }, () => acquireHiddenBrowser());
    const unique = new Set(acquired);
    expect(unique.size).toBe(HIDDEN_BROWSER_POOL_SIZE);
    expect(getHiddenBrowserUserCount()).toBe(HIDDEN_BROWSER_POOL_SIZE + 3);
  });

  it('release decrements refcount; next acquire reuses the idle slot', () => {
    const first = acquireHiddenBrowser();
    acquireHiddenBrowser();
    void releaseHiddenBrowser(first);
    expect(getHiddenBrowserUserCount()).toBe(1);

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

  it('isHiddenBrowserTab recognizes the pool session tab/window', async () => {
    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn().mockResolvedValue({ id: 111, tabs: [{ id: 1111 }] }),
      },
      tabs: {
        ungroup: vi.fn().mockResolvedValue(undefined),
      },
    });

    const browser = acquireHiddenBrowser();
    await browser.runExclusive((nav) => nav('https://example.com/a'));

    expect(isHiddenBrowserTab(1111, undefined)).toBe(true);
    expect(isHiddenBrowserTab(1111, 111)).toBe(true);
    expect(isHiddenBrowserTab(undefined, 111)).toBe(true);
    expect(isHiddenBrowserTab(9999, 111)).toBe(false);
    expect(isHiddenBrowserTab(9999, undefined)).toBe(false);
  });

  it('isHiddenBrowserTab does not treat a user tab in the same window as hidden', async () => {
    const own = { id: 1111, windowId: 111, groupId: -1 };
    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn().mockResolvedValue({ id: 111, tabs: [own] }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        get: vi.fn().mockResolvedValue(own),
        query: vi.fn().mockResolvedValue([
          own,
          { id: 9999, windowId: 111, groupId: -1 },
        ]),
        update: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
        ungroup: vi.fn().mockResolvedValue(undefined),
      },
    });

    const browser = acquireHiddenBrowser();
    await browser.runExclusive((nav) => nav('https://example.com/a'));

    expect(isHiddenBrowserTab(1111, 111)).toBe(true);
    expect(isHiddenBrowserTab(9999, 111)).toBe(false);
  });

  it('closeHiddenBrowser closes the pool slot', async () => {
    const own = { id: 1111, windowId: 111, groupId: -1 };
    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn().mockResolvedValue({ id: 111, tabs: [own] }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        get: vi.fn().mockResolvedValue(own),
        query: vi.fn().mockResolvedValue([own]),
        remove: vi.fn().mockResolvedValue(undefined),
        ungroup: vi.fn().mockResolvedValue(undefined),
      },
    });

    const browser = acquireHiddenBrowser();
    await browser.runExclusive((nav) => nav('https://example.com/a'));

    await closeHiddenBrowser();

    expect(isHiddenBrowserTab(1111, undefined)).toBe(false);
    expect(getHiddenBrowserUserCount()).toBe(0);
  });
});
