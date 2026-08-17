import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HiddenBrowser,
  __resetHiddenBrowserForTests,
} from '@/lib/hidden-browser';

const OWN_TAB = 1111;
const OWN_WIN = 111;
const OTHER_TAB = 2222;
const URL = 'https://www.wildberries.ru/catalog/1/detail.aspx';

function tab(partial: Partial<chrome.tabs.Tab> & { id: number; windowId: number }): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: false,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...partial,
  } as chrome.tabs.Tab;
}

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

describe('HiddenBrowser close / reuse isolation', () => {
  afterEach(() => {
    __resetHiddenBrowserForTests();
    vi.unstubAllGlobals();
  });

  it('closes a dedicated window via own tab then empty-window cleanup', async () => {
    const own = tab({ id: OWN_TAB, windowId: OWN_WIN, url: URL });
    const tabsRemove = vi.fn().mockResolvedValue(undefined);
    const windowsRemove = vi.fn().mockResolvedValue(undefined);
    const ungroup = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn().mockResolvedValue({ id: OWN_WIN, tabs: [own] }),
        remove: windowsRemove,
      },
      tabs: {
        get: vi.fn().mockResolvedValue(own),
        query: vi.fn().mockResolvedValue([own]),
        update: vi.fn(),
        remove: tabsRemove,
        ungroup,
      },
    });

    const browser = new HiddenBrowser();
    await browser.navigate(URL);
    await browser.close();

    expect(tabsRemove).toHaveBeenCalledWith(OWN_TAB);
    expect(windowsRemove).toHaveBeenCalledWith(OWN_WIN);
    expect(ungroup).not.toHaveBeenCalled();
  });

  it('does not windows.remove when other tabs share the window; ungroups own tab', async () => {
    const own = tab({ id: OWN_TAB, windowId: OWN_WIN, url: URL, groupId: 42 });
    const other = tab({ id: OTHER_TAB, windowId: OWN_WIN, url: 'https://example.com', groupId: 42 });
    const tabsRemove = vi.fn().mockResolvedValue(undefined);
    const windowsRemove = vi.fn().mockResolvedValue(undefined);
    const ungroup = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn().mockResolvedValue({ id: OWN_WIN, tabs: [own] }),
        remove: windowsRemove,
      },
      tabs: {
        get: vi.fn().mockResolvedValue(own),
        query: vi.fn().mockResolvedValue([own, other]),
        update: vi.fn(),
        remove: tabsRemove,
        ungroup,
      },
    });

    const browser = new HiddenBrowser();
    await browser.navigate(URL);
    await browser.close();

    expect(ungroup).toHaveBeenCalledWith(OWN_TAB);
    expect(tabsRemove).toHaveBeenCalledWith(OWN_TAB);
    expect(tabsRemove).not.toHaveBeenCalledWith(OTHER_TAB);
    expect(windowsRemove).not.toHaveBeenCalled();
  });

  it('does not tabs.update a hidden tab once user tabs share the window', async () => {
    const own = tab({ id: OWN_TAB, windowId: OWN_WIN, url: URL });
    const other = tab({ id: OTHER_TAB, windowId: OWN_WIN, url: 'https://ozon.ru/product/1' });
    const next = tab({ id: 3333, windowId: 222, url: URL });
    const tabsUpdate = vi.fn().mockResolvedValue(own);
    const tabsRemove = vi.fn().mockResolvedValue(undefined);
    const windowsCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: OWN_WIN, tabs: [own] })
      .mockResolvedValueOnce({ id: 222, tabs: [next] });

    vi.stubGlobal('chrome', {
      windows: {
        create: windowsCreate,
        remove: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        get: vi.fn().mockResolvedValue(own),
        query: vi.fn().mockResolvedValue([own, other]),
        update: tabsUpdate,
        remove: tabsRemove,
        ungroup: vi.fn().mockResolvedValue(undefined),
      },
    });

    const browser = new HiddenBrowser();
    const first = await browser.navigate(URL);
    expect(first).toBe(OWN_TAB);

    const second = await browser.navigate('https://www.ozon.ru/product/2');
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsRemove).toHaveBeenCalledWith(OWN_TAB);
    expect(second).toBe(3333);
    expect(windowsCreate).toHaveBeenCalledTimes(2);
  });

  it('does not claim a restored window that already has user tabs', async () => {
    const userTab = tab({
      id: OTHER_TAB,
      windowId: OWN_WIN,
      url: 'https://www.wildberries.ru/catalog/9/detail.aspx',
    });
    const injected = tab({ id: OWN_TAB, windowId: OWN_WIN, url: URL });
    const dedicated = tab({ id: 4444, windowId: 333, url: URL });
    const tabsRemove = vi.fn().mockResolvedValue(undefined);
    const windowsCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: OWN_WIN, tabs: [userTab, injected] })
      .mockResolvedValueOnce({ id: 333, tabs: [dedicated] });

    vi.stubGlobal('chrome', {
      windows: {
        create: windowsCreate,
        remove: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        get: vi.fn(),
        query: vi.fn(),
        update: vi.fn(),
        remove: tabsRemove,
        ungroup: vi.fn().mockResolvedValue(undefined),
      },
    });

    const browser = new HiddenBrowser();
    const tabId = await browser.navigate(URL);

    expect(tabId).toBe(4444);
    expect(browser.getWindowId()).toBe(333);
    expect(tabsRemove).toHaveBeenCalledWith(OWN_TAB);
    expect(tabsRemove).not.toHaveBeenCalledWith(OTHER_TAB);
  });
});
