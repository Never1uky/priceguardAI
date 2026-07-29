// PriceGuard AI — уведомления о ценах через @PriceGuardAlertsBot
//
// Auth: JWT пользователя. chatId берётся только из user_alert_settings (не из body).
// Secrets: TELEGRAM_BOT_TOKEN

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { sanitizeMarketplaceButtonUrl } from '../_shared/safe-url.ts';
import {
  buildCheaperElsewhereMessage,
  buildComparePriceDropMessage,
  buildPriceDropMessage,
  buildTargetPriceMessage,
  escapeHtml,
  sendTelegramMessage,
} from '../_shared/telegram.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** Готовый HTML от клиента — не экранировать повторно */
function looksLikeHtmlAlert(message: string): boolean {
  return /<\/?[bisu](?:\s|>|\/)/i.test(message);
}

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
        error: 'Войдите в аккаунт, чтобы отправлять Telegram-алерты',
        code: 'AUTH_REQUIRED',
      }, 401);
    }

    const body = await req.json();
    const supabase = serviceClient();

    const { data: settings } = await supabase
      .from('user_alert_settings')
      .select('telegram_chat_id, telegram_enabled, notifications_enabled')
      .eq('user_id', user!.id)
      .maybeSingle();

    const chatId = String(settings?.telegram_chat_id ?? '').trim().slice(0, 32);
    if (!chatId) {
      return jsonResponse({
        ok: false,
        error: 'Telegram Chat ID не сохранён в облаке. Сохраните настройки после входа.',
        code: 'CHAT_ID_MISSING',
      }, 400);
    }

    const url = sanitizeMarketplaceButtonUrl(body.url ? String(body.url) : undefined);
    const type = String(body.type ?? 'generic');
    const buttonText = body.buttonText ? String(body.buttonText).slice(0, 64) : undefined;

    let text = '';

    if (type === 'price_drop' && body.title != null && body.oldPrice != null && body.newPrice != null) {
      text = buildPriceDropMessage({
        title: String(body.title),
        oldPrice: Number(body.oldPrice),
        newPrice: Number(body.newPrice),
        marketplace: body.marketplace ? String(body.marketplace) : undefined,
      });
    } else if (
      type === 'compare_price_drop' &&
      body.title != null &&
      body.oldPrice != null &&
      body.newPrice != null
    ) {
      text = buildComparePriceDropMessage({
        title: String(body.title),
        oldPrice: Number(body.oldPrice),
        newPrice: Number(body.newPrice),
        marketplace: body.marketplace ? String(body.marketplace) : undefined,
      });
    } else if (
      type === 'cheaper_elsewhere' &&
      body.title != null &&
      (body.sourcePrice != null || body.oldPrice != null) &&
      body.newPrice != null
    ) {
      text = buildCheaperElsewhereMessage({
        title: String(body.title),
        sourceMarketplace: body.sourceMarketplace
          ? String(body.sourceMarketplace)
          : undefined,
        sourcePrice: Number(body.sourcePrice ?? body.oldPrice),
        cheaperMarketplace: body.marketplace ? String(body.marketplace) : undefined,
        cheaperPrice: Number(body.newPrice),
      });
    } else if (
      type === 'target_price' &&
      body.title != null &&
      body.newPrice != null &&
      body.targetPrice != null
    ) {
      text = buildTargetPriceMessage({
        title: String(body.title),
        currentPrice: Number(body.newPrice),
        targetPrice: Number(body.targetPrice),
        marketplace: body.marketplace ? String(body.marketplace) : undefined,
      });
    } else if (body.message) {
      const raw = String(body.message).slice(0, 3500);
      // Pre-built HTML alerts (legacy client) must not be double-escaped
      text = looksLikeHtmlAlert(raw) ? raw : escapeHtml(raw);
    }

    if (!text) {
      return jsonResponse({ ok: false, error: 'message or structured alert required' }, 400);
    }

    const result = await sendTelegramMessage({
      chatId,
      text,
      buttonUrl: url,
      buttonText: buttonText ?? (url ? '🛒 Открыть товар' : undefined),
    });

    return jsonResponse({ ok: true, sent: result.sent, error: result.error ?? null });
  } catch (error) {
    console.error('[price-alert-notify]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
