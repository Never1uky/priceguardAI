import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
vi.mock('@/lib/telemetry/log', () => ({
  telemetry: { info, warn: vi.fn(), error: vi.fn() },
}));

const storage = new Map<string, unknown>();

beforeEach(() => {
  info.mockClear();
  info.mockReset();
  info.mockImplementation(() => undefined);
  storage.clear();
  vi.resetModules();
  const local = {
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
  };
  vi.stubGlobal('chrome', {
    storage: {
      local,
      session: local,
    },
  });
});

describe('funnel compareOutcomeFromOfferStatuses', () => {
  it('derives coarse outcomes', async () => {
    const { compareOutcomeFromOfferStatuses } = await import('./funnel');
    expect(compareOutcomeFromOfferStatuses([])).toBe('error');
    expect(compareOutcomeFromOfferStatuses(['needs_choice', 'not_found'])).toBe('needs_choice');
    expect(compareOutcomeFromOfferStatuses(['verified', 'not_found'])).toBe('success');
    expect(compareOutcomeFromOfferStatuses(['probable'])).toBe('success');
    expect(compareOutcomeFromOfferStatuses(['not_found', 'oos'])).toBe('not_found');
    expect(compareOutcomeFromOfferStatuses(['blocked', 'error'])).toBe('error');
  });
});

describe('funnel is_first flags', () => {
  it('compare_started flips is_first once', async () => {
    const { trackCompareStarted } = await import('./funnel');
    await trackCompareStarted('wildberries');
    await trackCompareStarted('ozon');
    const started = info.mock.calls.filter((c) => c[0].name === 'compare_started');
    expect(started).toHaveLength(2);
    expect(started[0]![0].data).toEqual({ is_first: true });
    expect(started[1]![0].data).toEqual({ is_first: false });
    expect(started[0]![0].funnel).toBe(true);
  });

  it('ai_started flips is_first once', async () => {
    const { trackAiStarted } = await import('./funnel');
    await trackAiStarted({ mode: 'full', cache: 'miss' });
    await trackAiStarted({ mode: 'full', cache: 'hit' });
    const started = info.mock.calls.filter((c) => c[0].name === 'ai_started');
    expect(started[0]![0].data).toMatchObject({ is_first: true, mode: 'full' });
    expect(started[1]![0].data).toMatchObject({ is_first: false, cache: 'hit' });
  });
});

describe('funnel card open dedupe', () => {
  it('dedupes same marketplace+article within TTL', async () => {
    const { trackProductCardOpened } = await import('./funnel');
    await trackProductCardOpened('wildberries', '12345');
    await trackProductCardOpened('wildberries', '12345');
    await trackProductCardOpened('ozon', '12345');
    expect(info.mock.calls.filter((c) => c[0].name === 'product_card_opened')).toHaveLength(2);
    expect(info.mock.calls.filter((c) => c[0].name === 'marketplace_page_detected')).toHaveLength(2);
  });
});

describe('funnel privacy surface', () => {
  it('emits no url/title/product_id fields on install/checkout', async () => {
    const { trackExtensionInstalled, trackCheckoutStarted, trackPremiumActive } =
      await import('./funnel');
    trackExtensionInstalled('install');
    trackCheckoutStarted('yearly');
    trackPremiumActive('trial');
    for (const call of info.mock.calls) {
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toMatch(/https?:\/\//);
      expect(call[0].data?.url).toBeUndefined();
      expect(call[0].data?.title).toBeUndefined();
      expect(call[0].productId).toBeUndefined();
      expect(call[0].marketplace === undefined || ['wildberries', 'ozon', 'yandex_market'].includes(call[0].marketplace)).toBe(true);
    }
  });

  it('sanitizeFunnelData drops sensitive keys', async () => {
    const { sanitizeFunnelData } = await import('./funnel');
    const out = sanitizeFunnelData({
      url: 'https://wildberries.ru/x',
      title: 'Secret',
      product_id: '123',
      reviews: 9,
      failure_reason: 'product_not_found',
      is_first: true,
    });
    expect(out).toEqual({ failure_reason: 'product_not_found', is_first: true });
  });
});

describe('funnel duration and failures', () => {
  it('buckets duration', async () => {
    const { durationBucket } = await import('./funnel');
    expect(durationBucket(200)).toBe('lt_1s');
    expect(durationBucket(1500)).toBe('1_3s');
    expect(durationBucket(5000)).toBe('3_10s');
    expect(durationBucket(20_000)).toBe('10_30s');
    expect(durationBucket(40_000)).toBe('30s_plus');
  });

  it('does not classify product_not_found as parser_error', async () => {
    const { classifyFailureReason } = await import('./funnel');
    expect(classifyFailureReason(undefined, 'not_found')).toBe('product_not_found');
    expect(classifyFailureReason('JSON parse failed')).toBe('parser_error');
    expect(classifyFailureReason('Failed to fetch')).toBe('network_error');
    expect(classifyFailureReason('timeout')).toBe('timeout');
  });

  it('compare not_found emits comparison_failed with product_not_found', async () => {
    const { trackCompareCompleted } = await import('./funnel');
    trackCompareCompleted('not_found', 'ozon', { durationMs: 4000 });
    const failed = info.mock.calls.find((c) => c[0].name === 'comparison_failed');
    expect(failed?.[0].data?.failure_reason).toBe('product_not_found');
    expect(failed?.[0].data?.duration_bucket).toBe('3_10s');
    expect(failed?.[0].marketplace).toBe('ozon');
  });
});

describe('funnel extension_started and AI cache', () => {
  it('dedupes extension_started per session', async () => {
    const { trackExtensionStarted } = await import('./funnel');
    await trackExtensionStarted();
    await trackExtensionStarted();
    expect(info.mock.calls.filter((c) => c[0].name === 'extension_started')).toHaveLength(1);
  });

  it('emits ai_analysis_cache_hit on cache hit', async () => {
    const { trackAiStarted } = await import('./funnel');
    await trackAiStarted({ mode: 'full', cache: 'hit', provider: 'openai' });
    const names = info.mock.calls.map((c) => c[0].name);
    expect(names).toContain('ai_analysis_cache_hit');
    expect(names).toContain('ai_analysis_completed');
    const hit = info.mock.calls.find((c) => c[0].name === 'ai_analysis_cache_hit');
    expect(hit?.[0].data).toMatchObject({ source: 'cache', provider: 'openai' });
  });

  it('does not throw if telemetry.info throws', async () => {
    info.mockImplementation(() => {
      throw new Error('tel down');
    });
    const { trackCompareStarted } = await import('./funnel');
    await expect(trackCompareStarted('wildberries')).resolves.toBeUndefined();
  });
});
