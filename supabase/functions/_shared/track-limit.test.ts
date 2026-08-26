import { describe, expect, it } from 'vitest';
import { mayInsertTrackedProduct } from './track-limit.ts';
import { isTrialClaimActive, planFromSources } from './premium-active.ts';

describe('mayInsertTrackedProduct', () => {
  it('allows updates within existing active row', () => {
    expect(
      mayInsertTrackedProduct({
        isUpdateOfExisting: true,
        willBeDeleted: false,
        activeCount: 5,
        limit: 5,
      }),
    ).toEqual({ ok: true });
  });

  it('blocks new insert at Free cap', () => {
    expect(
      mayInsertTrackedProduct({
        isUpdateOfExisting: false,
        willBeDeleted: false,
        activeCount: 5,
        limit: 5,
      }),
    ).toEqual({ ok: false, code: 'TRACK_LIMIT' });
  });

  it('allows tombstone even over cap', () => {
    expect(
      mayInsertTrackedProduct({
        isUpdateOfExisting: false,
        willBeDeleted: true,
        activeCount: 99,
        limit: 5,
      }),
    ).toEqual({ ok: true });
  });

  it('blocks undelete when at cap', () => {
    expect(
      mayInsertTrackedProduct({
        isUpdateOfExisting: true,
        willBeDeleted: false,
        isUndelete: true,
        activeCount: 5,
        limit: 5,
      }),
    ).toEqual({ ok: false, code: 'TRACK_LIMIT' });
  });
});

describe('planFromSources / trial', () => {
  it('trial expires_at in future → premiumTier', () => {
    const plan = planFromSources({
      premiumRow: null,
      trialExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(plan.kind).toBe('trial');
    expect(plan.premiumTier).toBe(true);
    expect(plan.paidPremium).toBe(false);
  });

  it('paid premium wins over trial', () => {
    const plan = planFromSources({
      premiumRow: {
        expires_at: null,
        license_key_id: 'lk',
        license_keys: { is_active: true, expires_at: null },
      },
      trialExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(plan.kind).toBe('premium');
    expect(plan.paidPremium).toBe(true);
  });

  it('isTrialClaimActive', () => {
    expect(isTrialClaimActive(null)).toBe(false);
    expect(isTrialClaimActive(new Date(Date.now() - 1000).toISOString())).toBe(false);
    expect(isTrialClaimActive(new Date(Date.now() + 60_000).toISOString())).toBe(true);
  });
});
