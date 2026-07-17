/**
 * Восстановить Premium по привязке user_premium после переустановки.
 * JWT required. Не создаёт новую активацию устройства — только отдаёт ключ/план.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const user = await requireAuthUser(req, true);
    const userId = user!.id;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: premium, error } = await supabase
      .from('user_premium')
      .select('license_key_id, plan, expires_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[restore-license] fetch', error);
      return jsonResponse({ ok: false, error: 'Ошибка сервера' }, 500);
    }

    if (!premium?.license_key_id) {
      return jsonResponse({
        ok: true,
        restored: false,
        reason: 'no_premium',
      });
    }

    if (premium.expires_at && new Date(premium.expires_at) <= new Date()) {
      return jsonResponse({
        ok: true,
        restored: false,
        reason: 'expired',
      });
    }

    const { data: license, error: keyError } = await supabase
      .from('license_keys')
      .select('key_code, plan, expires_at, is_active')
      .eq('id', premium.license_key_id)
      .maybeSingle();

    if (keyError) {
      console.error('[restore-license] key', keyError);
      return jsonResponse({ ok: false, error: 'Ошибка сервера' }, 500);
    }

    if (!license?.is_active || !license.key_code) {
      return jsonResponse({
        ok: true,
        restored: false,
        reason: 'inactive',
      });
    }

    if (license.expires_at && new Date(license.expires_at) <= new Date()) {
      return jsonResponse({
        ok: true,
        restored: false,
        reason: 'expired',
      });
    }

    const plan = license.plan ?? premium.plan;
    const expiresAt = license.expires_at ?? premium.expires_at;

    return jsonResponse({
      ok: true,
      restored: true,
      licenseKey: license.key_code,
      plan,
      expiresAt: expiresAt ? new Date(expiresAt).getTime() : undefined,
      isLifetime: plan === 'lifetime' && !expiresAt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error';
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Войдите во вкладку «Аккаунт»' }, 401);
    }
    console.error('[restore-license]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
