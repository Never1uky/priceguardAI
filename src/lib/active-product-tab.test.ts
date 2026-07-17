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
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({ content_scripts: [{ js: ['assets/loader.js'] }] }),
      },
      tabs: {
        sendMessage: vi
          .fn()
          .mockRejectedValueOnce(new Error('Receiving end does not exist'))
          .mockResolvedValueOnce({ ok: true, product: { title: 'GPU' } }),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined),
      },
    });

    const { sendScrapeProductMessage } = await import('@/lib/active-product-tab');
    const response = await sendScrapeProductMessage(42, 2);
    expect(response).toEqual({ ok: true, product: { title: 'GPU' } });
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
