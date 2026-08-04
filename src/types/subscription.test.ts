import { describe, expect, it } from 'vitest';
import { FREE_LIMITS, PREMIUM_PLANS, TRIAL_DAYS } from '@/types/subscription';

describe('FREE_LIMITS', () => {
  it('allows up to 5 my-products (unified track+compare slots)', () => {
    expect(FREE_LIMITS.maxMyProducts).toBe(5);
    expect(FREE_LIMITS.maxTrackedProducts).toBe(5);
    expect(FREE_LIMITS.maxCompareProducts).toBe(5);
    expect(FREE_LIMITS.maxPriceAlerts).toBe(5);
  });

  it('limits AI analyses per day for free tier', async () => {
    expect(FREE_LIMITS.maxAiRequestsPerDay).toBe(3);
    expect(FREE_LIMITS.fullAnalysisEnabled).toBe(true);
    const { FREE_DAILY_AI_LIMIT } = await import('@/lib/api/ai-quota');
    expect(FREE_DAILY_AI_LIMIT).toBe(FREE_LIMITS.maxAiRequestsPerDay);
  });
});

describe('ALERT_PLAN', () => {
  it('free has alerts within track limit; premium capped + priority', async () => {
    const { ALERT_PLAN, PREMIUM_LIMITS } = await import('@/types/subscription');
    expect(ALERT_PLAN.free.maxTracked).toBe(5);
    expect(ALERT_PLAN.free.alerts).toBe(true);
    expect(ALERT_PLAN.free.priority).toBe(false);
    expect(ALERT_PLAN.premium.alerts).toBe(true);
    expect(ALERT_PLAN.premium.priority).toBe(true);
    expect(ALERT_PLAN.premium.maxTracked).toBe(50);
    expect(PREMIUM_LIMITS.maxMyProducts).toBe(50);
  });
});

describe('PREMIUM_PLANS', () => {
  it('has monthly and yearly checkout prices', () => {
    expect(PREMIUM_PLANS.monthly.priceRub).toBe(299);
    expect(PREMIUM_PLANS.yearly.priceRub).toBe(2490);
    expect(PREMIUM_PLANS.yearly.highlight).toBe(true);
  });
});

describe('TRIAL_DAYS', () => {
  it('is 7 days', () => {
    expect(TRIAL_DAYS).toBe(7);
  });
});
