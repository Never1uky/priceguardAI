import { describe, expect, it } from 'vitest';
import {
  aggregateMatchFeedback,
  multiUserMappingConfidence,
  shouldPromoteMultiUserMapping,
  MULTI_USER_MIN_ACCEPT_DAYS,
  MULTI_USER_MIN_ACCEPTS,
} from '@/lib/multi-user-mapping-policy';

describe('multi-user-mapping promotion', () => {
  it('requires minimum accepts on distinct days', () => {
    expect(MULTI_USER_MIN_ACCEPTS).toBe(2);
    expect(MULTI_USER_MIN_ACCEPT_DAYS).toBe(2);

    const oneDay = aggregateMatchFeedback([
      { accepted: true, created_at: '2026-07-01T10:00:00Z' },
      { accepted: true, created_at: '2026-07-01T18:00:00Z' },
    ]);
    expect(shouldPromoteMultiUserMapping(oneDay).ok).toBe(false);

    const twoDays = aggregateMatchFeedback([
      { accepted: true, created_at: '2026-07-01T10:00:00Z', user_id: 'u1' },
      { accepted: true, created_at: '2026-07-02T10:00:00Z', user_id: 'u2' },
    ]);
    expect(shouldPromoteMultiUserMapping(twoDays).ok).toBe(true);
  });

  it('requires distinct users when user_id present', () => {
    const sameUser = aggregateMatchFeedback([
      { accepted: true, created_at: '2026-07-01T10:00:00Z', user_id: 'u1' },
      { accepted: true, created_at: '2026-07-02T10:00:00Z', user_id: 'u1' },
    ]);
    expect(shouldPromoteMultiUserMapping(sameUser).ok).toBe(false);
    expect(shouldPromoteMultiUserMapping(sameUser).reason).toBe('insufficient_distinct_users');
  });

  it('blocks promotion when rejects >= accepts', () => {
    const stats = aggregateMatchFeedback([
      { accepted: true, created_at: '2026-07-01T10:00:00Z', user_id: 'u1' },
      { accepted: true, created_at: '2026-07-02T10:00:00Z', user_id: 'u2' },
      { accepted: false, created_at: '2026-07-03T10:00:00Z' },
      { accepted: false, created_at: '2026-07-04T10:00:00Z' },
    ]);
    expect(stats.accepts).toBe(2);
    expect(stats.rejects).toBe(2);
    expect(shouldPromoteMultiUserMapping(stats).ok).toBe(false);
  });

  it('blocks on low avg confidence', () => {
    const stats = aggregateMatchFeedback([
      {
        accepted: true,
        created_at: '2026-07-01T10:00:00Z',
        user_id: 'u1',
        match_confidence: 40,
      },
      {
        accepted: true,
        created_at: '2026-07-02T10:00:00Z',
        user_id: 'u2',
        match_confidence: 50,
      },
    ]);
    expect(shouldPromoteMultiUserMapping(stats).ok).toBe(false);
    expect(shouldPromoteMultiUserMapping(stats).reason).toBe('avg_confidence_low');
  });

  it('confidence grows with accepts but caps at 95', () => {
    expect(multiUserMappingConfidence(2)).toBe(80);
    expect(multiUserMappingConfidence(6)).toBe(95);
    expect(multiUserMappingConfidence(2, 88)).toBe(88);
  });
});
