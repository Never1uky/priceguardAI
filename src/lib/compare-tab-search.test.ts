import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('chrome', {
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    get: vi.fn(),
  },
  scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
  runtime: { getManifest: () => ({ version: '0.9.94-test' }) },
});

import {
  findOpenMarketplaceProductTabs,
  findOpenMarketplaceSerpTab,
  offerFromOpenProductScrape,
} from '@/lib/compare-tab-search';
import type { Product } from '@/types/product';

describe('findOpenMarketplaceSerpTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the active YM search tab for a related query', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 11,
        active: true,
        url: 'https://market.yandex.ru/search?text=Google%20Pixel%208',
        windowId: 1,
      },
    ] as chrome.tabs.Tab[]);

    const tabId = await findOpenMarketplaceSerpTab(
      'yandex_market',
      'Google Pixel 8 128',
    );
    expect(tabId).toBe(11);
  });

  it('ignores a SERP tab for an unrelated query', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 11,
        active: true,
        url: 'https://market.yandex.ru/search?text=Google%20Pixel',
        windowId: 1,
      },
    ] as chrome.tabs.Tab[]);

    const tabId = await findOpenMarketplaceSerpTab(
      'yandex_market',
      'Xiaomi Redmi Buds 8',
    );
    expect(tabId).toBeNull();
  });
});

describe('findOpenMarketplaceProductTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns open YM /card/ product tabs and skips SERP', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 21,
        active: false,
        url: 'https://market.yandex.ru/search?text=Pixel',
        windowId: 1,
      },
      {
        id: 22,
        active: true,
        url: 'https://market.yandex.ru/card/smartfon-google-pixel-7-pro-12-128gb-jp-obsidian-chernyi/123456789',
        windowId: 1,
      },
    ] as chrome.tabs.Tab[]);

    const tabs = await findOpenMarketplaceProductTabs('yandex_market');
    expect(tabs.map((t) => t.id)).toEqual([22]);
  });
});

describe('offerFromOpenProductScrape', () => {
  const baseProduct = (title: string, price = 45081): Product => ({
    id: 'ym:1',
    marketplace: 'yandex_market',
    title,
    price,
    currency: 'RUB',
    article: '123',
    url: 'https://market.yandex.ru/card/pixel-7-pro/123456789',
    scrapedAt: Date.now(),
  });

  it('auto-binds exact Pixel open card (verified)', () => {
    const offer = offerFromOpenProductScrape({
      marketplace: 'yandex_market',
      product: baseProduct(
        'Смартфон Google Pixel 7 Pro, 12/128Gb JP, Obsidian (Черный)',
      ),
      pageUrl: 'https://market.yandex.ru/card/pixel-7-pro-obsidian/123456789',
      referenceTitle: 'Смартфон Google Pixel 7 Pro 12/128GB Obsidian',
    });
    expect(offer).not.toBeNull();
    expect(offer!.matchStatus).toBe('verified');
    expect(offer!.found).toBe(true);
    expect(offer!.price).toBe(45081);
    expect(offer!.needsManualPick).toBeFalsy();
  });

  it('offers needs_choice or verified for same model different color (YM 12/128Gb vs 128GB)', () => {
    const offer = offerFromOpenProductScrape({
      marketplace: 'yandex_market',
      product: baseProduct(
        'Смартфон Google Pixel 7 Pro, 12/128Gb JP, Obsidian (Черный)',
      ),
      pageUrl: 'https://market.yandex.ru/card/pixel-7-pro-obsidian/123456789',
      referenceTitle: 'Смартфон Google Pixel 7 Pro 128GB Hazel',
    });
    expect(offer).not.toBeNull();
    expect(['verified', 'needs_choice']).toContain(offer!.matchStatus);
    expect(
      Boolean(offer!.found && offer!.price) ||
        Boolean(offer!.needsManualPick && offer!.searchCandidates?.length),
    ).toBe(true);
  });

  it('rejects unrelated open card (score 0)', () => {
    const offer = offerFromOpenProductScrape({
      marketplace: 'yandex_market',
      product: baseProduct('Чехол для Google Pixel 7 Pro силиконовый', 990),
      pageUrl: 'https://market.yandex.ru/card/case/999',
      referenceTitle: 'Смартфон Google Pixel 7 Pro 128GB Hazel',
    });
    expect(offer).toBeNull();
  });
});
