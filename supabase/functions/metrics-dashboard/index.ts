// PriceGuard AI — дашборд метрик (админ: расширение + landing /ops).
//
// Views: vw_search_metrics_daily/weekly, vw_ai_requests, vw_wb_success_rate_24h
// Extra aggregates: scrape sources, SEO pages, premium/trial, edge endpoint counts
//
// Access: JWT + email in METRICS_ADMIN_EMAILS (fail-closed if unset).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { canAccessMetrics, requireAuthUser } from '../_shared/auth.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function parsePeriodDays(raw: unknown): 1 | 7 | 30 {
  const n = Number(raw);
  if (n === 1 || n === 7 || n === 30) return n;
  return 30;
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

    let periodDays: 1 | 7 | 30 = 30;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        periodDays = parsePeriodDays(body?.periodDays);
      } catch {
        periodDays = 30;
      }
    }

    const supabase = serviceClient();
    const sinceIso = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const [
      daily,
      weekly,
      ai,
      wb24h,
      scrapeRaw,
      seoPublished,
      premiumActive,
      trialsActive,
      edgeRaw,
    ] = await Promise.all([
      supabase.from('vw_search_metrics_daily').select('*').limit(200),
      supabase.from('vw_search_metrics_weekly').select('*').limit(50),
      supabase.from('vw_ai_requests').select('*').limit(200),
      supabase.from('vw_wb_success_rate_24h').select('*').maybeSingle(),
      supabase
        .from('price_scrape_cache')
        .select('source')
        .gte('fetched_at', sinceIso),
      supabase
        .from('seo_product_pages')
        .select('view_count', { count: 'exact' })
        .eq('publish_status', 'published'),
      supabase
        .from('user_premium')
        .select('user_id', { count: 'exact', head: true })
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
      supabase
        .from('trial_claims')
        .select('id', { count: 'exact', head: true })
        .gt('expires_at', new Date().toISOString()),
      supabase
        .from('edge_request_log')
        .select('endpoint')
        .gte('created_at', sinceIso)
        .limit(5000),
    ]);

    if (daily.error) console.error('vw_search_metrics_daily', daily.error);
    if (weekly.error) console.error('vw_search_metrics_weekly', weekly.error);
    if (ai.error) console.error('vw_ai_requests', ai.error);
    if (wb24h.error) console.error('vw_wb_success_rate_24h', wb24h.error);
    if (scrapeRaw.error) console.error('price_scrape_cache', scrapeRaw.error);
    if (seoPublished.error) console.error('seo_product_pages', seoPublished.error);
    if (premiumActive.error) console.error('user_premium', premiumActive.error);
    if (trialsActive.error) console.error('trial_claims', trialsActive.error);
    if (edgeRaw.error) console.error('edge_request_log', edgeRaw.error);

    const scrapeBySource: Record<string, number> = {};
    for (const row of scrapeRaw.data ?? []) {
      const src = String((row as { source?: string }).source ?? 'unknown');
      scrapeBySource[src] = (scrapeBySource[src] ?? 0) + 1;
    }
    const scrapeTotal = Object.values(scrapeBySource).reduce((a, b) => a + b, 0);

    const seoRows = seoPublished.data ?? [];
    const seoViews = seoRows.reduce(
      (sum, r) => sum + (Number((r as { view_count?: number }).view_count) || 0),
      0,
    );

    const edgeByEndpoint: Record<string, number> = {};
    for (const row of edgeRaw.data ?? []) {
      const ep = String((row as { endpoint?: string }).endpoint ?? 'unknown');
      edgeByEndpoint[ep] = (edgeByEndpoint[ep] ?? 0) + 1;
    }
    const edgeTop = Object.entries(edgeByEndpoint)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const wbRate = Number(wb24h.data?.success_rate_pct ?? 100);
    const alertThreshold = Number(Deno.env.get('WB_SUCCESS_RATE_ALERT_THRESHOLD') ?? '85');
    const wbAlert = wbRate < alertThreshold && Number(wb24h.data?.total_requests ?? 0) >= 5;

    return jsonResponse({
      ok: true,
      generatedAt: new Date().toISOString(),
      periodDays,
      searchDaily: daily.data ?? [],
      searchWeekly: weekly.data ?? [],
      aiRequests: ai.data ?? [],
      wbSuccessRate24h: wb24h.data ?? null,
      scrape: {
        total: scrapeTotal,
        bySource: scrapeBySource,
        periodDays,
      },
      seo: {
        publishedCount: seoPublished.count ?? seoRows.length,
        totalViews: seoViews,
      },
      premium: {
        activeCount: premiumActive.count ?? 0,
        activeTrials: trialsActive.count ?? 0,
      },
      edge: {
        topEndpoints: edgeTop,
        sampleCapped: (edgeRaw.data?.length ?? 0) >= 5000,
      },
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
