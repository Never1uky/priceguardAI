import { describe, expect, it } from 'vitest';
import { isPremiumRowActive } from './premium-active.ts';

const now = new Date('2026-07-19T12:00:00.000Z');

describe('isPremiumRowActive', () => {
  it('false without row / license', () => {
    expect(isPremiumRowActive(null, now)).toBe(false);
    expect(isPremiumRowActive({ expires_at: null, license_key_id: null }, now)).toBe(false);
    expect(
      isPremiumRowActive(
        { expires_at: null, license_key_id: 'lic-1', license_keys: null },
        now,
      ),
    ).toBe(false);
  });

  it('true for active linked license (lifetime)', () => {
    expect(
      isPremiumRowActive(
        {
          expires_at: null,
          license_key_id: 'lic-1',
          license_keys: { is_active: true, expires_at: null },
        },
        now,
      ),
    ).toBe(true);
  });

  it('false when user_premium expired', () => {
    expect(
      isPremiumRowActive(
        {
          expires_at: '2026-01-01T00:00:00.000Z',
          license_key_id: 'lic-1',
          license_keys: { is_active: true, expires_at: null },
        },
        now,
      ),
    ).toBe(false);
  });

  it('false when license inactive or expired', () => {
    expect(
      isPremiumRowActive(
        {
          expires_at: null,
          license_key_id: 'lic-1',
          license_keys: { is_active: false, expires_at: null },
        },
        now,
      ),
    ).toBe(false);
    expect(
      isPremiumRowActive(
        {
          expires_at: null,
          license_key_id: 'lic-1',
          license_keys: { is_active: true, expires_at: '2026-01-01T00:00:00.000Z' },
        },
        now,
      ),
    ).toBe(false);
  });
});
