// PriceGuard AI — search-alerts (ops Reliability, multi-MP).
// Ops Telegram only (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). Not product MP Telegram.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { authorizeCronOrServiceRole } from '../_shared/cron-auth.ts';
import {
  evaluateSearchSuccessAlerts,
  formatSearchSuccessAlertTelegramHtml,
  resolveSearchSuccessAlertThreshold,
  type SearchSuccessRate24hRow,
} from '../_shared/search-success-alerts.ts';

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
    console.warn('[search-alerts] TELEGRAM_CHAT_ID looks invalid');
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

  if (!authorizeCronOrServiceRole(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const supabase = serviceClient();
    const threshold = resolveSearchSuccessAlertThreshold(Deno.env);

    const { data, error } = await supabase
      .from('vw_search_success_rate_24h')
      .select('*');

    if (error) {
      console.error('[search-alerts] vw_search_success_rate_24h', error);
      return jsonResponse({ ok: false, error: 'Read failed' }, 500);
    }

    const rows = (data ?? []) as SearchSuccessRate24hRow[];
    const evaluated = evaluateSearchSuccessAlerts(rows, threshold);
    const wb = evaluated.byMarketplace.find((r) => r.marketplace === 'wildberries');

    console.info(
      `[search-alerts] 24h threshold=${threshold}% alert=${evaluated.alert} ` +
        `alerting=[${evaluated.alerting.map((a) => a.marketplace).join(',')}] ` +
        evaluated.byMarketplace
          .map((r) => `${r.marketplace}:${r.successRatePct}%(${r.totalRequests})`)
          .join(' '),
    );

    let telegram: TelegramResult = { sent: false, skipped: true };
    if (evaluated.alert) {
      const message = formatSearchSuccessAlertTelegramHtml(evaluated.alerting, threshold);
      telegram = await sendTelegramAlert(message);
    }

    return jsonResponse({
      ok: true,
      alert: evaluated.alert,
      thresholdPct: threshold,
      byMarketplace: evaluated.byMarketplace,
      alertingMarketplaces: evaluated.alerting.map((a) => a.marketplace),
      // Legacy WB fields for older cron/log consumers
      wbSuccessRatePct: wb?.successRatePct ?? 100,
      totalRequests: wb?.totalRequests ?? 0,
      telegramSent: telegram.sent,
      telegramSkipped: telegram.skipped,
      telegramError: telegram.error ?? null,
    });
  } catch (error) {
    console.error('[search-alerts] error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
