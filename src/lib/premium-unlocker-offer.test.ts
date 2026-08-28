import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/subscription', () => ({
  isPremium: vi.fn(),
}));

vi.mock('@/lib/marketplaces/search-settings', () => ({
  getSelectedSearchMarketplaces: vi.fn(),
}));

vi.mock('@/lib/supabase/edge', () => ({
  callEdgeSafe: vi.fn(),
}));

vi.mock('@/lib/telemetry/compare-mp-attempt', () => ({
  trackCompareMpAttempt: vi.fn(),
}));

import { isPremium } from '@/lib/subscription';
import { getSelectedSearchMarketplaces } from '@/lib/marketplaces/search-settings';
import { callEdgeSafe } from '@/lib/supabase/edge';
import { trackCompareMpAttempt } from '@/lib/telemetry/compare-mp-attempt';
import {
  assertPremiumUnlockerAllowed,
  fetchOfferViaPremiumUnlocker,
  isPremiumUnlockerMarketplace,
} from '@/lib/premium-unlocker-offer';

describe('premium unlocker assert', () => {
  beforeEach(() => {
    vi.mocked(isPremium).mockReset();
    vi.mocked(getSelectedSearchMarketplaces).mockReset();
    vi.mocked(callEdgeSafe).mockReset();
    vi.mocked(trackCompareMpAttempt).mockReset();
  });

  it('only unlocker-eligible MPs (CORE + Mega/Ali/M.Video; not test MPs)', () => {
    expect(isPremiumUnlockerMarketplace('wildberries')).toBe(true);
    expect(isPremiumUnlockerMarketplace('megamarket')).toBe(true);
    expect(isPremiumUnlockerMarketplace('aliexpress')).toBe(true);
    expect(isPremiumUnlockerMarketplace('mvideo')).toBe(true);
    expect(isPremiumUnlockerMarketplace('lamoda')).toBe(false);
    expect(isPremiumUnlockerMarketplace('dns')).toBe(false);
  });

  it('denies not_premium / not_selected / not_core', async () => {
    const core = await assertPremiumUnlockerAllowed('dns');
    expect(core.ok).toBe(false);
    if (!core.ok) expect(core.reason).toBe('not_core');

    vi.mocked(isPremium).mockResolvedValue(false);
    const prem = await assertPremiumUnlockerAllowed('ozon');
    expect(prem.ok).toBe(false);
    if (!prem.ok) expect(prem.reason).toBe('not_premium');

    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(getSelectedSearchMarketplaces).mockResolvedValue(['wildberries']);
    const sel = await assertPremiumUnlockerAllowed('ozon');
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe('not_selected');
  });

  it('does not call Edge when assert fails', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(getSelectedSearchMarketplaces).mockResolvedValue(['wildberries']);
    const r = await fetchOfferViaPremiumUnlocker('https://www.ozon.ru/product/x-1', 'ozon');
    expect(r).toBeNull();
    expect(callEdgeSafe).not.toHaveBeenCalled();
    expect(trackCompareMpAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'skip', reason: 'unlocker_not_selected' }),
    );
  });

  it('calls Edge when premium + selected + core', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(getSelectedSearchMarketplaces).mockResolvedValue([
      'wildberries',
      'ozon',
      'yandex_market',
    ]);
    vi.mocked(callEdgeSafe).mockResolvedValue({
      ok: true,
      price: 999,
      title: 'X',
      url: 'https://www.ozon.ru/product/x-1',
    });
    const r = await fetchOfferViaPremiumUnlocker('https://www.ozon.ru/product/x-1', 'ozon');
    expect(r?.price).toBe(999);
    expect(callEdgeSafe).toHaveBeenCalledWith(
      'fetch-product-price',
      expect.objectContaining({
        marketplace: 'ozon',
        skipCache: false,
        selectedMarketplaces: ['wildberries', 'ozon', 'yandex_market'],
      }),
    );
    expect(trackCompareMpAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'scrappey', success: true }),
    );
  });

  it('MEGA-3: Mega unlocker calls Edge with skipCache false (post MEGA-4)', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(getSelectedSearchMarketplaces).mockResolvedValue([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
    ]);
    vi.mocked(callEdgeSafe).mockResolvedValue({
      ok: true,
      price: 42_000,
      title: 'Pixel',
      url: 'https://megamarket.ru/catalog/details/700008588462',
    });
    const r = await fetchOfferViaPremiumUnlocker(
      'https://megamarket.ru/catalog/details/smartfon-700008588462/',
      'megamarket',
    );
    expect(r?.price).toBe(42_000);
    expect(callEdgeSafe).toHaveBeenCalledWith(
      'fetch-product-price',
      expect.objectContaining({
        marketplace: 'megamarket',
        skipCache: false,
      }),
    );
  });

  it('ALI-3/4: Ali unlocker calls Edge with skipCache false (post ALI-4)', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(getSelectedSearchMarketplaces).mockResolvedValue([
      'wildberries',
      'ozon',
      'yandex_market',
      'aliexpress',
    ]);
    vi.mocked(callEdgeSafe).mockResolvedValue({
      ok: true,
      price: 1990,
      title: 'Case',
      url: 'https://aliexpress.ru/item/1005001234567890.html',
    });
    const r = await fetchOfferViaPremiumUnlocker(
      'https://aliexpress.ru/item/1005001234567890.html',
      'aliexpress',
    );
    expect(r?.price).toBe(1990);
    expect(callEdgeSafe).toHaveBeenCalledWith(
      'fetch-product-price',
      expect.objectContaining({
        marketplace: 'aliexpress',
        skipCache: false,
        productId: '1005001234567890',
      }),
    );
  });

  it('MVIDEO-3/4: mvideo unlocker calls Edge with skipCache false (post MVIDEO-4)', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(getSelectedSearchMarketplaces).mockResolvedValue([
      'wildberries',
      'ozon',
      'yandex_market',
      'mvideo',
    ]);
    vi.mocked(callEdgeSafe).mockResolvedValue({
      ok: true,
      price: 24_990,
      title: 'Phone',
      url: 'https://www.mvideo.ru/products/30066712',
    });
    const r = await fetchOfferViaPremiumUnlocker(
      'https://www.mvideo.ru/products/smartfon-30066712',
      'mvideo',
    );
    expect(r?.price).toBe(24_990);
    expect(callEdgeSafe).toHaveBeenCalledWith(
      'fetch-product-price',
      expect.objectContaining({
        marketplace: 'mvideo',
        skipCache: false,
        productId: '30066712',
      }),
    );
  });
});
