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

import { findOpenMarketplaceSerpTab } from '@/lib/compare-tab-search';

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
