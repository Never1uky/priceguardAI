import { describe, expect, it } from 'vitest';
import {
  deriveFullAnalysisQuotaIntent,
  fullAnalysisCacheBadgeLabel,
  shouldConsumeFullAnalysisQuota,
} from '@/lib/ai/full-analysis-quota-policy';

describe('full-analysis quota policy', () => {
  it('user_run + cache hit → consume', () => {
    expect(
      shouldConsumeFullAnalysisQuota({
        intent: 'user_run',
        ok: true,
        hasAnalysis: true,
      }),
    ).toBe(true);
  });

  it('user_run + error → no consume', () => {
    expect(
      shouldConsumeFullAnalysisQuota({
        intent: 'user_run',
        ok: false,
        hasAnalysis: false,
      }),
    ).toBe(false);
  });

  it('soft_refresh success → no consume', () => {
    expect(
      shouldConsumeFullAnalysisQuota({
        intent: 'soft_refresh',
        ok: true,
        hasAnalysis: true,
      }),
    ).toBe(false);
  });

  it('hard_refresh success → consume', () => {
    expect(
      shouldConsumeFullAnalysisQuota({
        intent: 'hard_refresh',
        ok: true,
        hasAnalysis: true,
      }),
    ).toBe(true);
  });

  it('derive intent from flags', () => {
    expect(deriveFullAnalysisQuotaIntent({})).toBe('user_run');
    expect(deriveFullAnalysisQuotaIntent({ softRefresh: true })).toBe('soft_refresh');
    expect(deriveFullAnalysisQuotaIntent({ forceHardRefresh: true })).toBe('hard_refresh');
    expect(deriveFullAnalysisQuotaIntent({ forceRefresh: true })).toBe('hard_refresh');
  });

  it('badge: hydrate vs run cache', () => {
    expect(fullAnalysisCacheBadgeLabel({ fromCache: true })).toBe('Из кэша');
    expect(
      fullAnalysisCacheBadgeLabel({ fromCache: true, quotaConsumed: true }),
    ).toBe('Из кэша · повторный запуск · попытка учтена');
    expect(fullAnalysisCacheBadgeLabel({ fromCache: false, quotaConsumed: true })).toBeNull();
    expect(
      fullAnalysisCacheBadgeLabel({ fromCache: true, cacheReason: 'CROSS_MARKETPLACE' }),
    ).toBe('Из кэша · Другая площадка');
    expect(
      fullAnalysisCacheBadgeLabel({
        fromCache: true,
        quotaConsumed: true,
        cacheReason: 'SAME_SKU',
      }),
    ).toBe('Из кэша · повторный запуск · попытка учтена');
  });
});
