/**
 * Единый критерий «активный Premium» для Edge / cron.
 * user_premium.expires_at недостаточно: нужен живой license_keys.
 */

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

/** select для PostgREST: user_premium + license_keys */
export const PREMIUM_ROW_SELECT =
  'user_id, expires_at, license_key_id, license_keys(is_active, expires_at)';
