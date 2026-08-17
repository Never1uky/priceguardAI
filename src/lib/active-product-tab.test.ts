import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/debug-log', () => ({
  agentLog: vi.fn(),
}));
import { pickActiveProductTab } from '@/lib/active-product-tab';
import { isProductPage } from '@/utils/marketplace';

describe('pickActiveProductTab', () => {
  const wbProduct = 'https://www.wildberries.ru/catalog/552334878/detail.aspx';
  const ozonProduct = 'https://www.ozon.ru/product/videokarta-123456789/';
  const wbSearch = 'https://www.wildberries.ru/catalog/0/search.aspx?search=gpu';

  it('prefers active product tab over inactive product tab', () => {
    const result = pickActiveProductTab([
      { id: 1, active: false, url: ozonProduct },
      { id: 2, active: true, url: wbProduct },
    ]);
    expect(result?.id).toBe(2);
  });

  it('returns product tab when currentWindow query would be empty (popup open)', () => {
    const result = pickActiveProductTab([{ id: 10, active: true, url: wbProduct }]);
    expect(result?.url).toBe(wbProduct);
  });

  it('ignores search pages and returns null when no product tab', () => {
    expect(pickActiveProductTab([{ id: 1, active: true, url: wbSearch }])).toBeNull();
  });

  it('falls back to first product tab if none marked active', () => {
    const result = pickActiveProductTab([
      { id: 1, active: false, url: ozonProduct },
      { id: 2, active: false, url: wbProduct },
    ]);
    expect(result?.id).toBe(1);
  });

  it('never picks minimized / hidden scrape windows', () => {
    const result = pickActiveProductTab([
      {
        id: 99,
        active: true,
        url: ozonProduct,
        windowId: 7,
        windowState: 'minimized',
      },
      { id: 2, active: false, url: wbProduct, windowState: 'normal' },
    ]);
    expect(result?.id).toBe(2);
  });

  it('still picks a user product tab in the same window as the hidden scrape tab', async () => {
    const own = {
      id: 99,
      windowId: 7,
      groupId: -1,
      url: ozonProduct,
    };
    vi.stubGlobal('chrome', {
      windows: {
        create: vi.fn().mockResolvedValue({ id: 7, tabs: [own] }),
      },
      tabs: {
        ungroup: vi.fn().mockResolvedValue(undefined),
      },
    });

    const { acquireHiddenBrowser, __resetHiddenBrowserForTests } = await import(
      '@/lib/hidden-browser'
    );
    try {
      const browser = acquireHiddenBrowser();
      await browser.navigate(ozonProduct);

      const result = pickActiveProductTab([
        { id: 99, active: true, url: ozonProduct, windowId: 7, windowState: 'normal' },
        { id: 2, active: false, url: wbProduct, windowId: 7, windowState: 'normal' },
      ]);
      expect(result?.id).toBe(2);
    } finally {
      __resetHiddenBrowserForTests();
      vi.unstubAllGlobals();
    }
  });
});

describe('isProductPage (WB)', () => {
  it('matches detail.aspx product urls', () => {
    expect(isProductPage('https://www.wildberries.ru/catalog/552334878/detail.aspx')).toBe(true);
  });
});

describe('sendScrapeProductMessage inject fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('injects content script when sendMessage initially fails', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Receiving end does not exist')) // SCRAPE
      .mockRejectedValueOnce(new Error('Receiving end does not exist')) // PING before inject
      .mockResolvedValueOnce({ ok: true }) // PING after inject
      .mockResolvedValueOnce({ ok: true, product: { title: 'GPU' } }); // SCRAPE retry

    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ content_scripts: [{ js: ['assets/loader.js'] }] }),
      },
      tabs: { sendMessage },
      scripting: {
        executeScript: vi
          .fn()
          .mockResolvedValueOnce(undefined) // file inject
          .mockResolvedValue([{ result: true }]), // waitForDomReady
      },
    });

    const { sendScrapeProductMessage } = await import('@/lib/active-product-tab');
    const response = await sendScrapeProductMessage(42, 2);
    expect(response).toEqual({ ok: true, product: { title: 'GPU' } });
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
