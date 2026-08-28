import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, unknown>();

vi.mock('./server-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./server-flags')>();
  return {
    ...actual,
    loadServerMarketplaceFlags: vi.fn(async () => ({
      wildberries: { marketplace_enabled: true, monitoring_enabled: true },
      ozon: { marketplace_enabled: true, monitoring_enabled: true },
      yandex_market: { marketplace_enabled: true, monitoring_enabled: true },
      megamarket: { marketplace_enabled: true, monitoring_enabled: false },
      aliexpress: { marketplace_enabled: true, monitoring_enabled: false },
      mvideo: { marketplace_enabled: true, monitoring_enabled: false },
      dns: { marketplace_enabled: true, monitoring_enabled: false },
      citilink: { marketplace_enabled: true, monitoring_enabled: false },
      lamoda: { marketplace_enabled: true, monitoring_enabled: false },
    })),
  };
});

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | Record<string, unknown>) => {
          const keys = typeof key === 'string' ? [key] : Array.isArray(key) ? key : Object.keys(key);
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (storage.has(k)) out[k] = storage.get(k);
          }
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
        }),
      },
    },
  });
});

describe('search-settings', () => {
  it('defaults to WB + Ozon + YM + Megamarket + AliExpress + M.Video (not remaining test MPs)', async () => {
    const { loadSearchMarketplacesSettings } = await import('./search-settings');
    const { DEFAULT_SEARCH_MARKETPLACE_IDS } = await import('./registry');
    const settings = await loadSearchMarketplacesSettings();
    expect(settings.selected).toEqual(DEFAULT_SEARCH_MARKETPLACE_IDS);
    expect(settings.selected).toContain('megamarket');
    expect(settings.selected).toContain('aliexpress');
    expect(settings.selected).toContain('mvideo');
    expect(DEFAULT_SEARCH_MARKETPLACE_IDS).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo',
    ]);
    const { TEST_MARKETPLACE_IDS } = await import('./adapter-config');
    for (const id of TEST_MARKETPLACE_IDS) {
      expect(settings.selected).not.toContain(id);
    }
  });

  it('normalizes empty / corrupt to defaults (includes megamarket + aliexpress + mvideo)', async () => {
    const { normalizeSearchMarketplaces } = await import('./search-settings');
    expect(normalizeSearchMarketplaces([])).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo',
    ]);
    expect(normalizeSearchMarketplaces(null)).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo',
    ]);
    expect(normalizeSearchMarketplaces(['nope', 1, 'ozon'])).toEqual(['ozon']);
  });

  it('saves and loads selected including megamarket and test MPs', async () => {
    const { saveSearchMarketplacesSettings, loadSearchMarketplacesSettings } = await import(
      './search-settings'
    );
    await saveSearchMarketplacesSettings(['ozon', 'megamarket', 'ozon']);
    const loaded = await loadSearchMarketplacesSettings();
    expect(loaded.selected).toEqual(['ozon', 'megamarket']);

    await saveSearchMarketplacesSettings(['wildberries', 'aliexpress', 'dns']);
    const loaded2 = await loadSearchMarketplacesSettings();
    expect(loaded2.selected).toEqual(['wildberries', 'aliexpress', 'dns']);
  });

  it('normalize keeps old trio config (does not inject new MPs)', async () => {
    const { normalizeSearchMarketplaces } = await import('./search-settings');
    expect(normalizeSearchMarketplaces(['wildberries', 'ozon', 'yandex_market'])).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
    ]);
    expect(normalizeSearchMarketplaces(['wildberries', 'ozon', 'yandex_market'])).not.toContain(
      'aliexpress',
    );
    expect(normalizeSearchMarketplaces(['wildberries', 'ozon', 'yandex_market'])).not.toContain(
      'megamarket',
    );
  });

  it('migrates legacy eldorado selection to mvideo', async () => {
    const { normalizeSearchMarketplaces } = await import('./search-settings');
    expect(normalizeSearchMarketplaces(['ozon', 'eldorado', 'mvideo'])).toEqual(['ozon', 'mvideo']);
    expect(normalizeSearchMarketplaces(['eldorado'])).toEqual(['mvideo']);
  });

  it('resolveCompareMarketplaces keeps source and filters onlyMarketplaces', async () => {
    const { resolveCompareMarketplaces } = await import('./search-settings');
    const all = resolveCompareMarketplaces({
      selected: ['wildberries', 'ozon', 'yandex_market'],
      sourceMarketplace: 'wildberries',
    });
    expect(all).toEqual(['wildberries', 'ozon', 'yandex_market']);

    const filtered = resolveCompareMarketplaces({
      selected: ['wildberries', 'ozon', 'yandex_market', 'megamarket'],
      sourceMarketplace: 'ozon',
      onlyMarketplaces: ['megamarket'],
    });
    expect(filtered).toEqual(['ozon', 'megamarket']);

    const withSourceForced = resolveCompareMarketplaces({
      selected: ['megamarket'],
      sourceMarketplace: 'wildberries',
    });
    expect(withSourceForced).toContain('wildberries');
    expect(withSourceForced).toContain('megamarket');

    const sixMp = resolveCompareMarketplaces({
      selected: ['wildberries', 'ozon', 'aliexpress'],
      sourceMarketplace: 'ozon',
      onlyMarketplaces: ['aliexpress'],
    });
    expect(sixMp).toEqual(['ozon', 'aliexpress']);
    expect(sixMp).not.toContain('mvideo');
  });
});
