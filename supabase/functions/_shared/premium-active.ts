/**
 * Единый критерий «активный Premium» для Edge / cron.
 * user_premium.expires_at недостаточно: нужен живой license_keys.
 * Phase 13: trial_claims тоже даёт Premium-tier лимиты (track/Scrappey UX).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export type PremiumLicenseJoin = {
  is_active: boolean | null;
  expires_at: string | null;
} | null;

export type PremiumRowLike = {
  expires_at?: string | null;
  license_key_id?: string | null;
  license_keys?: PremiumLicenseJoin | PremiumLicenseJoin[];
};

function unwrapLicense(row: PremiumRowLike): PremiumLicenseJoin {
  const raw = row.license_keys;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

/** true только если строка user_premium + привязанный ключ ещё действительны */
export function isPremiumRowActive(row: PremiumRowLike | null | undefined, now = new Date()): boolean {
  if (!row) return false;

  if (row.expires_at && new Date(row.expires_at) <= now) return false;

  if (!row.license_key_id) return false;

  const license = unwrapLicense(row);
  if (!license) return false;
  if (license.is_active === false) return false;
  if (license.expires_at && new Date(license.expires_at) <= now) return false;

  return true;
}

/** Pure: unexpired trial_claims.expires_at */
export function isTrialClaimActive(
  expiresAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt);
  return Number.isFinite(t.getTime()) && t > now;
}

export type UserPlanKind = 'free' | 'trial' | 'premium';

export interface UserPlanAccess {
  /** Paid license OR active trial — track caps, freshness, Scrappey UX */
  premiumTier: boolean;
  /** Paid license only (unlocker / billing) — same as premiumTier for Phase 13 */
  paidPremium: boolean;
  kind: UserPlanKind;
}

export function planFromSources(input: {
  premiumRow: PremiumRowLike | null | undefined;
  trialExpiresAt?: string | null;
  now?: Date;
}): UserPlanAccess {
  const now = input.now ?? new Date();
  if (isPremiumRowActive(input.premiumRow, now)) {
    return { premiumTier: true, paidPremium: true, kind: 'premium' };
  }
  if (isTrialClaimActive(input.trialExpiresAt, now)) {
    return { premiumTier: true, paidPremium: false, kind: 'trial' };
  }
  return { premiumTier: false, paidPremium: false, kind: 'free' };
}

/** Load paid premium + active trial for a user (service role). */
export async function resolveUserPlanAccess(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<UserPlanAccess> {
  const [premRes, trialRes] = await Promise.all([
    supabase
      .from('user_premium')
      .select(PREMIUM_ROW_SELECT)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('trial_claims')
      .select('expires_at')
      .eq('user_id', userId)
      .gt('expires_at', now.toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return planFromSources({
    premiumRow: premRes.data as PremiumRowLike | null,
    trialExpiresAt: (trialRes.data as { expires_at?: string } | null)?.expires_at ?? null,
    now,
  });
}

/** select для PostgREST: user_premium + license_keys */
export const PREMIUM_ROW_SELECT =
  'user_id, expires_at, license_key_id, license_keys(is_active, expires_at)';
