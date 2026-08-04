// PriceGuard AI — claim one-time Premium trial (requires Telegram chat_id on account).
// POST { deviceId } + JWT → inserts trial_claims; returns expiresAt (ms).
// Paid Premium (validate-license / YooKassa) does NOT use this path.
//
// TRIAL_DAYS must stay in sync with src/types/subscription.ts → TRIAL_DAYS

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { handleCors, jsonResponse } from '../_shared/utils.ts';

/** Sync with client `TRIAL_DAYS` in src/types/subscription.ts */
const TRIAL_DAYS = 7;

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const authUser = await requireAuthUser(req, true);
    if (!authUser) {
      return jsonResponse(
        { ok: false, error: 'Войдите во вкладку «Аккаунт»', code: 'auth_required' },
        401,
      );
    }

    const body = (await req.json().catch(() => ({}))) as { deviceId?: string };
    const deviceId = String(body.deviceId ?? '').trim().slice(0, 64);
    if (!deviceId) {
      return jsonResponse({ ok: false, error: 'deviceId обязателен', code: 'bad_request' }, 400);
    }

    const supabase = serviceClient();

    const { data: settings, error: settingsError } = await supabase
      .from('user_alert_settings')
      .select('telegram_chat_id')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (settingsError) {
      console.error('[claim-trial] settings', settingsError);
      return jsonResponse({ ok: false, error: 'Ошибка сервера' }, 500);
    }

    const chatId = String(settings?.telegram_chat_id ?? '').trim();
    if (!chatId) {
      return jsonResponse(
        {
          ok: false,
          error: 'Подключите Telegram в Настройках (Chat ID), затем повторите.',
          code: 'telegram_required',
        },
        400,
      );
    }

    const { data: byChat } = await supabase
      .from('trial_claims')
      .select('id')
      .eq('telegram_chat_id', chatId)
      .maybeSingle();

    const { data: byDevice } = await supabase
      .from('trial_claims')
      .select('id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (byChat || byDevice) {
      return jsonResponse(
        {
          ok: false,
          error: 'Пробный период уже использован на этом устройстве или Telegram.',
          code: 'trial_already_used',
        },
        409,
      );
    }

    const expiresAtMs = Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    const { error: insertError } = await supabase.from('trial_claims').insert({
      user_id: authUser.id,
      device_id: deviceId,
      telegram_chat_id: chatId,
      expires_at: expiresAtIso,
    });

    if (insertError) {
      // Race: unique violation
      if (insertError.code === '23505') {
        return jsonResponse(
          {
            ok: false,
            error: 'Пробный период уже использован на этом устройстве или Telegram.',
            code: 'trial_already_used',
          },
          409,
        );
      }
      console.error('[claim-trial] insert', insertError);
      return jsonResponse({ ok: false, error: 'Ошибка сервера' }, 500);
    }

    console.info(
      `[claim-trial] user=${authUser.id} device=${deviceId.slice(0, 8)}… chat=${chatId.slice(0, 6)}…`,
    );

    return jsonResponse({ ok: true, expiresAt: expiresAtMs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse(
        { ok: false, error: 'Войдите во вкладку «Аккаунт»', code: 'auth_required' },
        401,
      );
    }
    console.error('[claim-trial]', error);
    return jsonResponse({ ok: false, error: 'Ошибка сервера' }, 500);
  }
});
