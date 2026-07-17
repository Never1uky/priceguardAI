// PriceGuard AI — дашборд метрик (внутренняя админ-страница расширения).
//
// Возвращает данные из SQL Views:
//   vw_search_metrics_daily, vw_search_metrics_weekly, vw_ai_requests, vw_wb_success_rate_24h
//
// Доступ: JWT пользователя + email в METRICS_ADMIN_EMAILS (или любой auth user, если список пуст).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { canAccessMetrics, requireAuthUser } from '../_shared/auth.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const user = await requireAuthUser(req, true);
    if (!canAccessMetrics(user!.email)) {
      return jsonResponse({ ok: false, error: 'Доступ запрещён' }, 403);
    }

    const supabase = serviceClient();

    const [daily, weekly, ai, wb24h] = await Promise.all([
      supabase.from('vw_search_metrics_daily').select('*').limit(200),
      supabase.from('vw_search_metrics_weekly').select('*').limit(50),
      supabase.from('vw_ai_requests').select('*').limit(200),
      supabase.from('vw_wb_success_rate_24h').select('*').maybeSingle(),
    ]);

    if (daily.error) console.error('vw_search_metrics_daily', daily.error);
    if (weekly.error) console.error('vw_search_metrics_weekly', weekly.error);
    if (ai.error) console.error('vw_ai_requests', ai.error);
    if (wb24h.error) console.error('vw_wb_success_rate_24h', wb24h.error);

    const wbRate = Number(wb24h.data?.success_rate_pct ?? 100);
    const alertThreshold = Number(Deno.env.get('WB_SUCCESS_RATE_ALERT_THRESHOLD') ?? '85');
    const wbAlert = wbRate < alertThreshold && Number(wb24h.data?.total_requests ?? 0) >= 5;

    return jsonResponse({
      ok: true,
      generatedAt: new Date().toISOString(),
      searchDaily: daily.data ?? [],
      searchWeekly: weekly.data ?? [],
      aiRequests: ai.data ?? [],
      wbSuccessRate24h: wb24h.data ?? null,
      alerts: {
        wbLowSuccessRate: wbAlert,
        wbSuccessRatePct: wbRate,
        thresholdPct: alertThreshold,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('metrics-dashboard error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
