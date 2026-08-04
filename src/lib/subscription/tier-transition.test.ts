import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SubscriptionState } from '@/types/subscription';

const storage = new Map<string, unknown>();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
        if (typeof keys === 'string') {
          return { [keys]: storage.get(keys) };
        }
        if (Array.isArray(keys)) {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = storage.get(k);
          return out;
        }
        return {};
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) storage.set(k, v);
      }),
    },
  },
});

const clearPremiumClaimOnServer = vi.fn(async () => ({ ok: true }));
const syncAlertSettingsToCloud = vi.fn(async () => ({ ok: true }));

vi.mock('@/lib/supabase/alert-settings-sync', () => ({
  clearPremiumClaimOnServer,
  syncAlertSettingsToCloud,
}));

vi.mock('@/lib/supabase/client', () => ({
  isSupabaseConfigured: () => true,
  claimTrialRemote: vi.fn(),
  validateLicenseRemote: vi.fn(),
  restoreLicenseRemote: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-guard', () => ({
  canUseCloudFeatures: vi.fn(async () => true),
  AI_AUTH_REQUIRED_MESSAGE: 'auth',
}));

vi.mock('@/lib/compare-price-alerts', () => ({
  getPriceAlertSettings: vi.fn(async () => ({
    notificationsEnabled: true,
    minDropRub: 100,
    minDropPercent: 1,
    compareAlerts: true,
    telegramEnabled: true,
    telegramChatId: '123456',
  })),
}));

vi.mock('@/lib/subscription/device-id', () => ({
  getDeviceId: vi.fn(async () => 'device-test-1'),
}));

vi.mock('@/lib/my-products', () => ({
  getMyProductSlotCount: vi.fn(async () => 7),
  getMyProductsLimit: vi.fn(() => 5),
  loadMyProductItems: vi.fn(async () => []),
  findMyProductByUrl: vi.fn(() => null),
}));

describe('tier transition helpers', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it('isPremiumSubscriptionActive — expired expiresAt → false', async () => {
    const { isPremiumSubscriptionActive } = await import('@/lib/subscription');
    const sub: SubscriptionState = {
      tier: 'premium',
      expiresAt: Date.now() - 60_000,
      source: 'trial',
    };
    expect(isPremiumSubscriptionActive(sub)).toBe(false);
  });

  it('getSubscription downgrades expired trial to free', async () => {
    storage.set('priceguard_subscription', {
      tier: 'premium',
      expiresAt: Date.now() - 60_000,
      source: 'trial',
    });
    storage.set('priceguard_trial_used', true);

    const { getSubscription } = await import('@/lib/subscription');
    const sub = await getSubscription();
    expect(sub.tier).toBe('free');
    expect(clearPremiumClaimOnServer).not.toHaveBeenCalled();
    expect(storage.get('priceguard_trial_used')).toBe(true);
  });

  it('getSubscription clears server claim on paid premium expiry', async () => {
    storage.set('priceguard_subscription', {
      tier: 'premium',
      expiresAt: Date.now() - 60_000,
      source: 'supabase',
      licenseKey: 'PGAI-TEST-KEY',
    });

    const { getSubscription } = await import('@/lib/subscription');
    const sub = await getSubscription();
    expect(sub.tier).toBe('free');
    await vi.waitFor(() => expect(clearPremiumClaimOnServer).toHaveBeenCalled());
  });

  it('after downgrade getAiQuotaStatus is limited', async () => {
    storage.set('priceguard_subscription', { tier: 'free' });

    const { getAiQuotaStatus } = await import('@/lib/subscription');
    const quota = await getAiQuotaStatus();
    expect(quota.unlimited).toBe(false);
    expect(quota.limit).toBe(3);
  });

  it('canAddMyProduct blocks new slot when free and count >= limit', async () => {
    storage.set('priceguard_subscription', { tier: 'free' });

    const { canAddMyProduct } = await import('@/lib/subscription');
    const gate = await canAddMyProduct({ url: 'https://www.ozon.ru/product/new/' });
    expect(gate.allowed).toBe(false);
    expect(gate.limit).toBe(5);
    expect(gate.count).toBe(7);
  });

  it('startTrial claims via Edge and stores trial subscription', async () => {
    const { claimTrialRemote } = await import('@/lib/supabase/client');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    vi.mocked(claimTrialRemote).mockResolvedValueOnce({ ok: true, expiresAt });

    const { startTrial, getSubscription } = await import('@/lib/subscription');
    const result = await startTrial();
    expect(result.ok).toBe(true);
    expect(result.expiresAt).toBe(expiresAt);
    expect(storage.get('priceguard_trial_used')).toBe(true);
    const sub = await getSubscription();
    expect(sub.tier).toBe('premium');
    expect(sub.source).toBe('trial');
  });

  it('startTrial without local Telegram fails before Edge', async () => {
    const { getPriceAlertSettings } = await import('@/lib/compare-price-alerts');
    vi.mocked(getPriceAlertSettings).mockResolvedValueOnce({
      notificationsEnabled: true,
      minDropRub: 100,
      minDropPercent: 1,
      compareAlerts: true,
      telegramEnabled: false,
      telegramChatId: '',
    });
    const { claimTrialRemote } = await import('@/lib/supabase/client');

    const { startTrial } = await import('@/lib/subscription');
    const result = await startTrial();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Telegram/i);
    expect(claimTrialRemote).not.toHaveBeenCalled();
  });

  it('startTrial marks local used when server says trial_already_used', async () => {
    const { claimTrialRemote } = await import('@/lib/supabase/client');
    vi.mocked(claimTrialRemote).mockResolvedValueOnce({
      ok: false,
      code: 'trial_already_used',
      error: 'used',
    });

    const { startTrial } = await import('@/lib/subscription');
    const result = await startTrial();
    expect(result.ok).toBe(false);
    expect(storage.get('priceguard_trial_used')).toBe(true);
  });
});
