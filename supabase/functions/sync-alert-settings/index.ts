/**
 * Sync Telegram alert settings + claim Premium for auth user.
 *
 * JWT required.
 * POST { action: "get" } — вернуть текущие настройки
 * POST {
 *   telegramEnabled, telegramChatId, notificationsEnabled,
 *   minDropRub, minDropPercent, licenseKey?, clearTelegram?
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse, normalizeKey } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import { bindLicenseToUser } from '../_shared/license-bind.ts';
import { isPremiumRowActive } from '../_shared/premium-active.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function shouldPreserveCloudTelegram(input: {
  incomingChatId: string;
  clearTelegram: boolean;
  existingChatId: string | null | undefined;
}): boolean {
  if (input.clearTelegram) return false;
  if (input.incomingChatId.trim().length > 0) return false;
  return Boolean(input.existingChatId?.trim());
}

async function premiumStatus(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  licenseKey: string,
) {
  let premiumActive = false;
  let premiumExpiresAt: number | null = null;

  if (licenseKey) {
    const { data: license } = await supabase
      .from('license_keys')
      .select('id, plan, expires_at, is_active')
      .eq('key_code', licenseKey)
      .maybeSingle();

    if (
      license?.is_active &&
      (!license.expires_at || new Date(license.expires_at) > new Date())
    ) {
      const bind = await bindLicenseToUser(supabase, userId, {
        id: license.id,
        plan: license.plan,
        expires_at: license.expires_at,
      });

      if (!bind.ok && bind.code === 'LICENSE_OWNED_BY_OTHER') {
        return { error: bind.error as string, code: bind.code as string };
      }

      if (bind.ok) {
        await supabase
          .from('license_activations')
          .update({ user_id: userId })
          .eq('license_key_id', license.id)
          .is('user_id', null);

        premiumActive = true;
        premiumExpiresAt = license.expires_at
          ? new Date(license.expires_at).getTime()
          : null;
      }
    }
  } else {
    const { data: existing } = await supabase
      .from('user_premium')
      .select('user_id, expires_at, license_key_id, plan, license_keys(is_active, expires_at)')
      .eq('user_id', userId)
      .maybeSingle();

    if (isPremiumRowActive(existing)) {
      premiumActive = true;
      premiumExpiresAt = existing?.expires_at
        ? new Date(existing.expires_at).getTime()
        : null;
    }
  }

  return { premiumActive, premiumExpiresAt };
}

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
    const body = await req.json();
    const supabase = serviceClient();

    const { data: existingRow } = await supabase
      .from('user_alert_settings')
      .select(
        'telegram_enabled, telegram_chat_id, notifications_enabled, min_drop_rub, min_drop_percent, server_monitoring',
      )
      .eq('user_id', userId)
      .maybeSingle();

    // ——— Pull ———
    if (body.action === 'get') {
      const prem = await premiumStatus(supabase, userId, '');
      if ('error' in prem && prem.error) {
        return jsonResponse({ ok: false, error: prem.error, code: prem.code }, 403);
      }

      return jsonResponse({
        ok: true,
        settings: existingRow
          ? {
              telegramEnabled: Boolean(existingRow.telegram_enabled),
              telegramChatId: String(existingRow.telegram_chat_id ?? ''),
              notificationsEnabled: existingRow.notifications_enabled !== false,
              minDropRub: Number(existingRow.min_drop_rub) || 100,
              minDropPercent: Number(existingRow.min_drop_percent) || 1,
              serverMonitoring: Boolean(existingRow.server_monitoring),
            }
          : null,
        premiumActive: Boolean(prem.premiumActive),
        premiumExpiresAt: prem.premiumExpiresAt ?? null,
      });
    }

    // ——— Clear Premium claim (local deactivate / expired license) ———
    if (body.clearPremium === true) {
      const { error: clearPremError } = await supabase
        .from('user_premium')
        .delete()
        .eq('user_id', userId);
      if (clearPremError) {
        console.error('[sync-alert-settings] clearPremium', clearPremError);
        return jsonResponse({ ok: false, error: 'Не удалось сбросить Premium на сервере' }, 500);
      }
      return jsonResponse({ ok: true, premiumActive: false, clearedPremium: true });
    }

    // ——— Upsert ———
    let telegramEnabled = Boolean(body.telegramEnabled);
    let telegramChatId = String(body.telegramChatId ?? '').trim().slice(0, 32);
    const notificationsEnabled = body.notificationsEnabled !== false;
    const minDropRub = Math.max(0, Number(body.minDropRub) || 100);
    const minDropPercent = Math.max(0, Number(body.minDropPercent) || 1);
    const clearTelegram = Boolean(body.clearTelegram);

    if (
      shouldPreserveCloudTelegram({
        incomingChatId: telegramChatId,
        clearTelegram,
        existingChatId: existingRow?.telegram_chat_id,
      })
    ) {
      telegramChatId = String(existingRow!.telegram_chat_id).trim();
      telegramEnabled = Boolean(existingRow!.telegram_enabled);
    }

    if (clearTelegram) {
      telegramChatId = '';
      telegramEnabled = false;
    }

    const serverMonitoring =
      telegramEnabled &&
      telegramChatId.length > 0 &&
      notificationsEnabled;

    if (telegramChatId.length > 0) {
      const { error: clearError } = await supabase
        .from('user_alert_settings')
        .update({
          telegram_chat_id: '',
          telegram_enabled: false,
          server_monitoring: false,
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_chat_id', telegramChatId)
        .neq('user_id', userId);

      if (clearError) {
        console.warn('[sync-alert-settings] clear other chat bindings', clearError);
      }
    }

    const { error: settingsError } = await supabase.from('user_alert_settings').upsert(
      {
        user_id: userId,
        telegram_enabled: telegramEnabled,
        telegram_chat_id: telegramChatId,
        notifications_enabled: notificationsEnabled,
        min_drop_rub: minDropRub,
        min_drop_percent: minDropPercent,
        server_monitoring: serverMonitoring,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    if (settingsError) {
      console.error('[sync-alert-settings] upsert', settingsError);
      return jsonResponse({ ok: false, error: 'Не удалось сохранить настройки' }, 500);
    }

    const licenseKey = body.licenseKey ? normalizeKey(String(body.licenseKey)) : '';
    const prem = await premiumStatus(supabase, userId, licenseKey);
    if ('error' in prem && prem.error) {
      return jsonResponse({ ok: false, error: prem.error, code: prem.code }, 403);
    }

    const eligible = serverMonitoring;

    return jsonResponse({
      ok: true,
      serverMonitoring: eligible,
      premiumActive: Boolean(prem.premiumActive),
      alertPriority: Boolean(prem.premiumActive) && eligible,
      premiumExpiresAt: prem.premiumExpiresAt ?? null,
      telegramLinked: serverMonitoring,
      telegramChatId,
      telegramEnabled,
      freeTrackLimit: 5,
      preservedCloudTelegram: shouldPreserveCloudTelegram({
        incomingChatId: String(body.telegramChatId ?? ''),
        clearTelegram,
        existingChatId: existingRow?.telegram_chat_id,
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error';
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Войдите во вкладку «Аккаунт»' }, 401);
    }
    console.error('[sync-alert-settings]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
