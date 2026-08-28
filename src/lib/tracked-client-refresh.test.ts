import { describe, expect, it } from 'vitest';
import {
  compareProductNeedsClientRefresh,
  selectTrackedForClientRefresh,
} from '@/lib/tracked-client-refresh';
import type { CompareProduct } from '@/types/comparison';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function tracked(mp: string, scrapedAt: number) {
  return { marketplace: mp, scrapedAt };
}

describe('selectTrackedForClientRefresh (MEGA-6 / ALI-6 / MVIDEO-6)', () => {
  it('always includes Mega/Ali/M.Video when server monitoring is on (cron does not scrape them)', () => {
    const rows = [
      tracked('wildberries', NOW - HOUR),
      tracked('megamarket', NOW - HOUR),
      tracked('aliexpress', NOW - HOUR),
      tracked('mvideo', NOW - HOUR),
      tracked('ozon', NOW - 9 * HOUR),
    ];
    const out = selectTrackedForClientRefresh(rows, {
      serverMonitoringActive: true,
      now: NOW,
    });
    expect(out.map((r) => r.marketplace).sort()).toEqual([
      'aliexpress',
      'megamarket',
      'mvideo',
      'ozon',
    ]);
  });

  it('checks everyone when monitoring is off or force', () => {
    const rows = [
      tracked('wildberries', NOW),
      tracked('megamarket', NOW),
      tracked('aliexpress', NOW),
      tracked('mvideo', NOW),
    ];
    expect(
      selectTrackedForClientRefresh(rows, { serverMonitoringActive: false, now: NOW }),
    ).toHaveLength(4);
    expect(
      selectTrackedForClientRefresh(rows, {
        force: true,
        serverMonitoringActive: true,
        now: NOW,
      }),
    ).toHaveLength(4);
  });
});

describe('compareProductNeedsClientRefresh (MEGA-6 / ALI-6 / MVIDEO-6)', () => {
  const base: Pick<
    CompareProduct,
    'sourceMarketplace' | 'comparedAt' | 'marketplaceUrls' | 'marketplaceOffers'
  > = {
    sourceMarketplace: 'wildberries',
    comparedAt: NOW - HOUR,
    marketplaceUrls: {},
    marketplaceOffers: {},
  };

  it('skips fresh CORE-only compare when cron is on', () => {
    expect(
      compareProductNeedsClientRefresh(base, {
        serverMonitoringActive: true,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('always refreshes when Mega is bound', () => {
    expect(
      compareProductNeedsClientRefresh(
        {
          ...base,
          marketplaceUrls: { megamarket: 'https://megamarket.ru/catalog/details/1/' },
        },
        { serverMonitoringActive: true, now: NOW },
      ),
    ).toBe(true);
  });

  it('always refreshes when Ali is bound', () => {
    expect(
      compareProductNeedsClientRefresh(
        {
          ...base,
          marketplaceUrls: {
            aliexpress: 'https://aliexpress.ru/item/1005001234567890.html',
          },
        },
        { serverMonitoringActive: true, now: NOW },
      ),
    ).toBe(true);
  });

  it('always refreshes when M.Video is bound', () => {
    expect(
      compareProductNeedsClientRefresh(
        {
          ...base,
          marketplaceUrls: {
            mvideo: 'https://www.mvideo.ru/products/smartfon-30066712',
          },
        },
        { serverMonitoringActive: true, now: NOW },
      ),
    ).toBe(true);
  });

  it('always refreshes Mega/Ali/M.Video source card', () => {
    expect(
      compareProductNeedsClientRefresh(
        { ...base, sourceMarketplace: 'megamarket' },
        { serverMonitoringActive: true, now: NOW },
      ),
    ).toBe(true);
    expect(
      compareProductNeedsClientRefresh(
        { ...base, sourceMarketplace: 'aliexpress' },
        { serverMonitoringActive: true, now: NOW },
      ),
    ).toBe(true);
    expect(
      compareProductNeedsClientRefresh(
        { ...base, sourceMarketplace: 'mvideo' },
        { serverMonitoringActive: true, now: NOW },
      ),
    ).toBe(true);
  });
});
