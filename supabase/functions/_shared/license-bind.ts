/**
 * Привязка лицензии к auth-аккаунту (user_premium).
 * Один ключ — один владелец; чужой ключ не перехватывается.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export type BindLicenseResult =
  | { ok: true; bound: boolean }
  | { ok: false; error: string; code: 'LICENSE_OWNED_BY_OTHER' | 'BIND_FAILED' };

/**
 * Upsert user_premium for userId ↔ licenseKeyId.
 * Returns LICENSE_OWNED_BY_OTHER if another account already owns this key.
 */
export async function bindLicenseToUser(
  supabase: SupabaseClient,
  userId: string,
  license: {
    id: string;
    plan: string | null;
    expires_at: string | null;
  },
): Promise<BindLicenseResult> {
  const { data: owner } = await supabase
    .from('user_premium')
    .select('user_id')
    .eq('license_key_id', license.id)
    .maybeSingle();

  if (owner?.user_id && owner.user_id !== userId) {
    return {
      ok: false,
      error: 'Этот ключ уже привязан к другому аккаунту',
      code: 'LICENSE_OWNED_BY_OTHER',
    };
  }

  const { error } = await supabase.from('user_premium').upsert(
    {
      user_id: userId,
      license_key_id: license.id,
      plan: license.plan,
      expires_at: license.expires_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    // Unique on license_key_id — race with another binder
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'Этот ключ уже привязан к другому аккаунту',
        code: 'LICENSE_OWNED_BY_OTHER',
      };
    }
    console.error('[license-bind] upsert', error);
    return {
      ok: false,
      error: 'Не удалось привязать ключ к аккаунту',
      code: 'BIND_FAILED',
    };
  }

  return { ok: true, bound: true };
}
