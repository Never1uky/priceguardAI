// Еженедельный дайджест метрик (vw_search_metrics_weekly) → Telegram.
//
// Запуск: cron (Supabase) или POST из background по alarm раз в неделю.
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')?.trim();

  if (!token || !chatId) {
    console.warn('[weekly-metrics-digest] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    return { ok: false, error: 'telegram_not_configured' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const body = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
    if (!response.ok || !body.ok) {
      const err = body.description ?? `HTTP ${response.status}`;
      console.error('[weekly-metrics-digest] Telegram API error:', err);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error('[weekly-metrics-digest] Telegram fetch failed:', err);
    return { ok: false, error: err };
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
    const { data, error } = await supabase
      .from('vw_search_metrics_weekly')
      .select('*')
      .order('week_start', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[weekly-metrics-digest] view read failed', error);
      return jsonResponse({ ok: false, error: 'Read failed' }, 500);
    }

    const rows = data ?? [];
    const lines = rows.map(
      (r: Record<string, unknown>) =>
        `• <b>${r.marketplace}</b> ${r.week_start}: ${r.success_rate_pct}% ` +
        `(${r.successful_requests}/${r.total_requests}, avg ${r.avg_response_time_ms}ms)`,
    );

    const message =
      `📊 <b>PriceGuard — недельный дайджест</b>\n` +
      `${new Date().toISOString().slice(0, 10)}\n\n` +
      (lines.length ? lines.join('\n') : 'Нет данных за неделю');

    const telegram = await sendTelegram(message);

    return jsonResponse({
      ok: true,
      rowCount: rows.length,
      telegramSent: telegram.ok,
      telegramError: telegram.error,
    });
  } catch (error) {
    console.error('[weekly-metrics-digest] error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
