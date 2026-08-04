// Уведомления в поддержку @priceguard_supportbot / админ-чат
//
// Auth: JWT. Chat всегда TELEGRAM_SUPPORT_CHAT_ID (не из body).
// Secrets: TELEGRAM_SUPPORT_BOT_TOKEN / TELEGRAM_BOT_TOKEN, TELEGRAM_SUPPORT_CHAT_ID

import { requireAuthUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import {
  buildSupportErrorMessage,
  sendTelegramMessage,
} from '../_shared/telegram.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    let user;
    try {
      user = await requireAuthUser(req, true);
    } catch {
      return jsonResponse({
        ok: false,
        error: 'Auth required',
        code: 'AUTH_REQUIRED',
      }, 401);
    }

    const body = await req.json();
    const message = String(body.message ?? '').trim().slice(0, 1500);
    if (!message) {
      return jsonResponse({ ok: false, error: 'message required' }, 400);
    }

    const supportChat =
      Deno.env.get('TELEGRAM_SUPPORT_CHAT_ID')?.trim() ||
      Deno.env.get('TELEGRAM_CHAT_ID')?.trim();

    if (!supportChat) {
      return jsonResponse({
        ok: false,
        error: 'TELEGRAM_SUPPORT_CHAT_ID / TELEGRAM_CHAT_ID not configured',
      }, 500);
    }

    const text = buildSupportErrorMessage({
      message,
      context: body.context ? String(body.context).slice(0, 200) : undefined,
      version: body.version ? String(body.version).slice(0, 32) : undefined,
      userId: user!.id,
    });

    const result = await sendTelegramMessage({
      chatId: supportChat,
      text,
      buttonUrl: 'https://t.me/priceguard_supportbot',
      buttonText: '💬 Поддержка',
      botToken:
        Deno.env.get('TELEGRAM_SUPPORT_BOT_TOKEN')?.trim() ||
        Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ||
        undefined,
    });

    return jsonResponse({ ok: true, sent: result.sent, error: result.error ?? null });
  } catch (error) {
    console.error('[support-notify]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
