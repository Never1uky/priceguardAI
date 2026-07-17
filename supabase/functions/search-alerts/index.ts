// PriceGuard AI — search-alerts с подробным логированием Telegram.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

interface TelegramResult {
  sent: boolean;
  skipped: boolean;
  error?: string;
  httpStatus?: number;
}

async function sendTelegramAlert(message: string): Promise<TelegramResult> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')?.trim();

  if (!token) {
    console.warn('[search-alerts] TELEGRAM_BOT_TOKEN not set — skip Telegram');
    return { sent: false, skipped: true, error: 'TELEGRAM_BOT_TOKEN missing' };
  }
  if (!chatId) {
    console.warn('[search-alerts] TELEGRAM_CHAT_ID not set — skip Telegram');
    return { sent: false, skipped: true, error: 'TELEGRAM_CHAT_ID missing' };
  }

  if (!/^\d+$/.test(chatId) && !chatId.startsWith('-')) {
    console.warn('[search-alerts] TELEGRAM_CHAT_ID looks invalid:', chatId.slice(0, 6));
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      description?: string;
    };

    if (!response.ok || !body.ok) {
      const err = body.description ?? `HTTP ${response.status}`;
      console.error('[search-alerts] Telegram failed:', err, { status: response.status });
      return { sent: false, skipped: false, error: err, httpStatus: response.status };
    }

    console.info('[search-alerts] Telegram sent OK');
    return { sent: true, skipped: false };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error('[search-alerts] Telegram exception:', err);
    return { sent: false, skipped: false, error: err };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabase = serviceClient();
    const threshold = Number(Deno.env.get('WB_SUCCESS_RATE_ALERT_THRESHOLD') ?? '85');

    const { data, error } = await supabase
      .from('vw_wb_success_rate_24h')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[search-alerts] vw_wb_success_rate_24h', error);
      return jsonResponse({ ok: false, error: 'Read failed' }, 500);
    }

    const total = Number(data?.total_requests ?? 0);
    const rate = Number(data?.success_rate_pct ?? 100);
    const alert = total >= 5 && rate < threshold;

    console.info(
      `[search-alerts] WB 24h: rate=${rate}% total=${total} threshold=${threshold}% alert=${alert}`,
    );

    let telegram: TelegramResult = { sent: false, skipped: true };
    if (alert) {
      const message =
        `⚠️ <b>PriceGuard AI</b>\n` +
        `Поиск Wildberries: success rate <b>${rate}%</b> за 24ч ` +
        `(порог ${threshold}%, запросов: ${total})`;
      telegram = await sendTelegramAlert(message);
    }

    return jsonResponse({
      ok: true,
      alert,
      wbSuccessRatePct: rate,
      totalRequests: total,
      thresholdPct: threshold,
      telegramSent: telegram.sent,
      telegramSkipped: telegram.skipped,
      telegramError: telegram.error ?? null,
    });
  } catch (error) {
    console.error('[search-alerts] error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
