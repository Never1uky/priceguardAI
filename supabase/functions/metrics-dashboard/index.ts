// PriceGuard AI — дашборд метрик (админ: расширение + landing /ops).
//
// Views: vw_search_metrics_daily/weekly, vw_ai_requests, vw_search_success_rate_24h
// Extra aggregates: scrape sources, SEO pages, premium/trial, edge endpoint counts
//
// Access: JWT + email in METRICS_ADMIN_EMAILS (fail-closed if unset).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { canAccessMetrics, requireAuthUser } from '../_shared/auth.ts';
import { OPS_EVENT_NAMES } from '../_shared/ops-telemetry.ts';
import {
  buildEconomicsDashboard,
  countScrappeyMonitorScrapes,
} from '../_shared/economics-dashboard.ts';
import {
  evaluateSearchSuccessAlerts,
  resolveSearchSuccessAlertThreshold,
  type SearchSuccessRate24hRow,
} from '../_shared/search-success-alerts.ts';

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

const FUNNEL_NAMES = [
  'extension_installed',
  'extension_started',
  'product_card_opened',
  'marketplace_page_detected',
  'compare_started',
  'compare_completed',
  'comparison_failed',
  'compare_rejected',
  'compare_candidate_selected',
  'match_completed',
  'match_failed',
  'match_manual_selection',
  'ai_started',
  'ai_analysis_started',
  'ai_analysis_completed',
  'ai_analysis_failed',
  'ai_analysis_cache_hit',
  'product_tracking_added',
  'product_tracking_removed',
  'monitoring_refresh',
  'monitoring_refresh_failed',
  'telegram_linked',
  'telegram_connect_started',
  'telegram_connected',
  'telegram_disconnected',
  'trial_claimed',
  'checkout_started',
  'premium_active',
  'premium_page_opened',
];

type FunnelRow = {
  name?: string;
  marketplace?: string | null;
  success?: boolean | null;
  payload?: Record<string, unknown> | null;
  client_ts?: string | null;
  created_at?: string | null;
};

function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((1000 * num) / den) / 10;
}

function aggregateProductFunnel(rows: FunnelRow[]) {
  const count = (names: string | string[]) => {
    const set = new Set(Array.isArray(names) ? names : [names]);
    return rows.filter((r) => set.has(String(r.name))).length;
  };

  const installs = count('extension_installed');
  const started = count('extension_started');
  const detected = count('marketplace_page_detected');
  const marketplaceDetected = detected || count('product_card_opened');
  const comparisons = count('compare_started');
  const compareDone = rows.filter((r) => r.name === 'compare_completed');
  const successful = compareDone.filter((r) => r.success === true || r.payload?.outcome === 'success').length;
  const aiCompleted = count('ai_analysis_completed');
  const ai = aiCompleted || count('ai_started');
  const aiCacheHits =
    count('ai_analysis_cache_hit') ||
    rows.filter((r) => r.name === 'ai_analysis_completed' && r.payload?.source === 'cache').length;
  const aiGenerated = Math.max(
    0,
    (aiCompleted || count('ai_started')) - aiCacheHits,
  );
  const tracked = count('product_tracking_added');
  const telegramConnected = count('telegram_connected');
  const telegram = telegramConnected || count('telegram_linked');
  const premiumTrial = count(['trial_claimed', 'premium_active', 'premium_page_opened']);

  const mpMap = new Map<string, { comparisons: number; success: number; failed: number }>();
  for (const r of rows) {
    const mp = r.marketplace || 'unknown';
    const cur = mpMap.get(mp) ?? { comparisons: 0, success: 0, failed: 0 };
    if (r.name === 'compare_started') cur.comparisons += 1;
    if (r.name === 'compare_completed' && (r.success === true || r.payload?.outcome === 'success')) {
      cur.success += 1;
    }
    if (r.name === 'comparison_failed' || (r.name === 'compare_completed' && r.success === false)) {
      cur.failed += 1;
    }
    mpMap.set(mp, cur);
  }
  const byMarketplace = [...mpMap.entries()]
    .filter(([mp, v]) => mp !== 'unknown' || v.comparisons || v.success || v.failed)
    .map(([marketplace, v]) => ({
      marketplace,
      comparisons: v.comparisons,
      success: v.success,
      failed: v.failed,
      successRatePct: pct(v.success, v.comparisons || v.success + v.failed),
    }))
    .sort((a, b) => a.marketplace.localeCompare(b.marketplace));

  const errMap = new Map<
    string,
    { reason: string; marketplace: string; count: number; lastSeen: string }
  >();
  for (const r of rows) {
    if (r.name !== 'comparison_failed' && r.name !== 'monitoring_refresh_failed' && r.name !== 'ai_analysis_failed') {
      continue;
    }
    const reason = String(r.payload?.failure_reason ?? 'unknown');
    const marketplace = String(r.marketplace ?? 'unknown');
    const key = `${reason}|${marketplace}`;
    const ts = String(r.client_ts ?? r.created_at ?? '');
    const cur = errMap.get(key);
    if (!cur) {
      errMap.set(key, { reason, marketplace, count: 1, lastSeen: ts });
    } else {
      cur.count += 1;
      if (ts > cur.lastSeen) cur.lastSeen = ts;
    }
  }
  const errors = [...errMap.values()].sort((a, b) => b.count - a.count).slice(0, 40);

  const providerMap = new Map<string, number>();
  for (const r of rows) {
    if (r.name !== 'ai_analysis_completed' && r.name !== 'ai_started' && r.name !== 'ai_analysis_cache_hit') {
      continue;
    }
    const p = String(r.payload?.provider ?? 'unknown');
    providerMap.set(p, (providerMap.get(p) ?? 0) + 1);
  }

  return {
    installs,
    started,
    marketplaceDetected,
    comparisons,
    successful,
    ai,
    tracked,
    telegram,
    premiumTrial,
    conversions: {
      installToComparison: pct(comparisons, installs),
      comparisonToSuccess: pct(successful, comparisons),
      successToTracking: pct(tracked, successful),
      trackingToTelegram: pct(telegram, tracked),
      startedToPremium: pct(count(['trial_claimed', 'premium_active']), started),
    },
    byMarketplace,
    errors,
    aiFunnel: {
      analyses: ai,
      cacheHits: aiCacheHits,
      generated: aiGenerated,
      hitRatePct: pct(aiCacheHits, ai || aiCacheHits + aiGenerated),
      byProvider: [...providerMap.entries()]
        .map(([provider, count]) => ({ provider, count }))
        .sort((a, b) => b.count - a.count),
    },
    sampleCapped: rows.length >= 8000,
  };
}

type OpsRow = {
  name?: string;
  marketplace?: string | null;
  success?: boolean | null;
  error_code?: string | null;
  payload?: Record<string, unknown> | null;
  client_ts?: string | null;
  created_at?: string | null;
};

type MpOpsCounters = {
  searchStarted: number;
  searchSuccess: number;
  searchFailed: number;
  scrapeRequest: number;
  scrapeCacheHit: number;
  scrapeCacheMiss: number;
  monitorCheck: number;
  monitorCacheHit: number;
  monitorScrape: number;
  alertsSent: number;
  monitorError: number;
  scrapeCostUnits: number;
};

function emptyMpOps(): MpOpsCounters {
  return {
    searchStarted: 0,
    searchSuccess: 0,
    searchFailed: 0,
    scrapeRequest: 0,
    scrapeCacheHit: 0,
    scrapeCacheMiss: 0,
    monitorCheck: 0,
    monitorCacheHit: 0,
    monitorScrape: 0,
    alertsSent: 0,
    monitorError: 0,
    scrapeCostUnits: 0,
  };
}

function scrapeCostWeight(source: unknown): number {
  const s = String(source ?? '');
  if (s === 'scrappey') return 10;
  if (s === 'tab') return 3;
  if (s === 'legacy' || s === 'api') return 1;
  return 0;
}

function aggregateOperationalMetrics(rows: OpsRow[]) {
  const byMp = new Map<string, MpOpsCounters>();
  const bump = (mp: string, patch: Partial<MpOpsCounters>) => {
    const cur = byMp.get(mp) ?? emptyMpOps();
    for (const [k, v] of Object.entries(patch)) {
      (cur as Record<string, number>)[k] = ((cur as Record<string, number>)[k] ?? 0) + (v ?? 0);
    }
    byMp.set(mp, cur);
  };

  const errMap = new Map<string, { reason: string; marketplace: string; count: number }>();
  for (const r of rows) {
    const mp = String(r.marketplace ?? 'unknown');
    switch (r.name) {
      case 'marketplace_search_started':
        bump(mp, { searchStarted: 1 });
        break;
      case 'marketplace_search_success':
        bump(mp, { searchSuccess: 1 });
        break;
      case 'marketplace_search_failed':
        bump(mp, { searchFailed: 1 });
        break;
      case 'scrape_request':
        bump(mp, {
          scrapeRequest: 1,
          scrapeCostUnits: scrapeCostWeight(r.payload?.source),
        });
        break;
      case 'scrape_cache_hit':
        bump(mp, { scrapeCacheHit: 1 });
        break;
      case 'scrape_cache_miss':
        bump(mp, { scrapeCacheMiss: 1 });
        break;
      case 'telegram_monitor_check':
        bump(mp, { monitorCheck: 1 });
        break;
      case 'telegram_monitor_cache_hit':
        bump(mp, { monitorCacheHit: 1 });
        break;
      case 'telegram_monitor_scrape':
        bump(mp, {
          monitorScrape: 1,
          scrapeCostUnits: scrapeCostWeight(r.payload?.source),
        });
        break;
      case 'telegram_alert_sent':
        bump(mp, { alertsSent: 1 });
        break;
      case 'telegram_monitor_error': {
        bump(mp, { monitorError: 1 });
        const reason = String(r.error_code ?? r.payload?.reason ?? 'unknown');
        const key = `${reason}|${mp}`;
        errMap.set(key, {
          reason,
          marketplace: mp,
          count: (errMap.get(key)?.count ?? 0) + 1,
        });
        break;
      }
    }
  }

  const totals = emptyMpOps();
  for (const v of byMp.values()) {
    for (const key of Object.keys(totals) as (keyof MpOpsCounters)[]) {
      totals[key] += v[key];
    }
  }

  const cacheDenom = totals.scrapeCacheHit + totals.scrapeCacheMiss;
  const monitorScrapeDenom = totals.monitorCacheHit + totals.monitorScrape;

  const byMarketplace = [...byMp.entries()]
    .map(([marketplace, v]) => ({
      marketplace,
      ...v,
      searchSuccessRatePct: pct(v.searchSuccess, v.searchStarted || v.searchSuccess + v.searchFailed),
      scrapeCacheHitRatePct: pct(v.scrapeCacheHit, v.scrapeCacheHit + v.scrapeCacheMiss),
      monitorCacheHitRatePct: pct(v.monitorCacheHit, v.monitorCacheHit + v.monitorScrape),
      scrapePerMonitorCheck:
        v.monitorCheck > 0
          ? Math.round((1000 * v.monitorScrape) / v.monitorCheck) / 1000
          : 0,
    }))
    .sort((a, b) => b.scrapeCostUnits - a.scrapeCostUnits || a.marketplace.localeCompare(b.marketplace));

  const mostExpensive = byMarketplace.slice(0, 5).map((r) => ({
    marketplace: r.marketplace,
    scrapeCostUnits: r.scrapeCostUnits,
    monitorScrapes: r.monitorScrape,
    scrapeRequests: r.scrapeRequest,
  }));

  const mostFailed = [...byMarketplace]
    .map((r) => ({
      marketplace: r.marketplace,
      searchFailed: r.searchFailed,
      monitorErrors: r.monitorError,
      totalFailures: r.searchFailed + r.monitorError,
    }))
    .filter((r) => r.totalFailures > 0)
    .sort((a, b) => b.totalFailures - a.totalFailures)
    .slice(0, 8);

  return {
    totals: {
      ...totals,
      scrapeCacheHitRatePct: pct(totals.scrapeCacheHit, cacheDenom),
      monitorCacheHitRatePct: pct(totals.monitorCacheHit, monitorScrapeDenom),
      scrapePerMonitorCheck:
        totals.monitorCheck > 0
          ? Math.round((1000 * totals.monitorScrape) / totals.monitorCheck) / 1000
          : 0,
      alertsSent: totals.alertsSent,
    },
    byMarketplace,
    mostExpensiveMarketplaces: mostExpensive,
    mostFailedMarketplaces: mostFailed,
    monitorErrors: [...errMap.values()].sort((a, b) => b.count - a.count).slice(0, 30),
    sampleCapped: rows.length >= 12000,
  };
}

async function loadMonitoringInventory(
  supabase: ReturnType<typeof serviceClient>,
) {
  const settingsRes = await supabase
    .from('user_alert_settings')
    .select('user_id')
    .eq('server_monitoring', true)
    .eq('telegram_enabled', true)
    .eq('notifications_enabled', true)
    .neq('telegram_chat_id', '');

  const monitoringUserIds = [
    ...new Set(
      (settingsRes.data ?? [])
        .map((r) => String((r as { user_id?: string }).user_id ?? '').trim())
        .filter(Boolean),
    ),
  ];

  if (monitoringUserIds.length === 0) {
    return {
      monitoringUsers: 0,
      activeMonitoredProducts: 0,
      trackedProducts: 0,
      uniqueMonitoringTargets: 0,
      avgSubscribersPerTarget: 0,
      maxSubscribersPerTarget: 0,
      totalSubscriberLinks: 0,
      targetsByMarketplace: [] as Array<{ marketplace: string; uniqueTargets: number }>,
      sampleCapped: false,
    };
  }

  // Chunk .in() to stay under PostgREST URL limits
  const CHUNK = 100;
  const trackedRows: Array<{ marketplace?: string; product_id?: string; user_id?: string }> = [];
  for (let i = 0; i < monitoringUserIds.length; i += CHUNK) {
    const chunk = monitoringUserIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('tracked_products')
      .select('marketplace, product_id, user_id')
      .eq('deleted', false)
      .in('user_id', chunk)
      .limit(15000);
    if (error) {
      console.error('tracked_products inventory', error);
      continue;
    }
    trackedRows.push(...((data ?? []) as typeof trackedRows));
  }

  const targetSubs = new Map<string, Set<string>>();
  const mpUnique = new Map<string, Set<string>>();
  for (const row of trackedRows) {
    const mp = String(row.marketplace ?? 'unknown');
    const pid = String(row.product_id ?? '').trim();
    const uid = String(row.user_id ?? '').trim();
    if (!pid || !uid) continue;
    const key = `${mp}:${pid}`;
    const subs = targetSubs.get(key) ?? new Set<string>();
    subs.add(uid);
    targetSubs.set(key, subs);
    const mpSet = mpUnique.get(mp) ?? new Set<string>();
    mpSet.add(pid);
    mpUnique.set(mp, mpSet);
  }

  const subscriberCounts = [...targetSubs.values()].map((s) => s.size);
  const totalSubscriberLinks = subscriberCounts.reduce((a, b) => a + b, 0);
  const avgSubscribersPerTarget = subscriberCounts.length
    ? Math.round((1000 * totalSubscriberLinks) / subscriberCounts.length) / 1000
    : 0;
  const maxSubscribersPerTarget = subscriberCounts.length
    ? Math.max(...subscriberCounts)
    : 0;

  const targetsByMarketplace = [...mpUnique.entries()]
    .map(([marketplace, set]) => ({ marketplace, uniqueTargets: set.size }))
    .sort((a, b) => b.uniqueTargets - a.uniqueTargets);

  return {
    monitoringUsers: monitoringUserIds.length,
    /** Alias: active tracked rows for monitoring users */
    activeMonitoredProducts: totalSubscriberLinks,
    trackedProducts: totalSubscriberLinks,
    uniqueMonitoringTargets: targetSubs.size,
    avgSubscribersPerTarget,
    maxSubscribersPerTarget,
    totalSubscriberLinks,
    targetsByMarketplace,
    sampleCapped: trackedRows.length >= 15000,
  };
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
      search24h,
      scrapeRaw,
      seoPublished,
      premiumActive,
      trialsActive,
      edgeRaw,
      funnelRaw,
      opsRaw,
      monitoringInventory,
    ] = await Promise.all([
      supabase.from('vw_search_metrics_daily').select('*').limit(200),
      supabase.from('vw_search_metrics_weekly').select('*').limit(50),
      supabase.from('vw_ai_requests').select('*').limit(200),
      supabase.from('vw_search_success_rate_24h').select('*'),
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
      supabase
        .from('telemetry_events')
        .select('name, marketplace, success, payload, client_ts, created_at')
        .in('name', FUNNEL_NAMES)
        .gte('created_at', sinceIso)
        .limit(8000),
      supabase
        .from('telemetry_events')
        .select('name, marketplace, success, error_code, payload, client_ts, created_at')
        .in('name', [...OPS_EVENT_NAMES])
        .gte('created_at', sinceIso)
        .limit(12000),
      loadMonitoringInventory(supabase),
    ]);

    if (daily.error) console.error('vw_search_metrics_daily', daily.error);
    if (weekly.error) console.error('vw_search_metrics_weekly', weekly.error);
    if (ai.error) console.error('vw_ai_requests', ai.error);
    if (search24h.error) console.error('vw_search_success_rate_24h', search24h.error);
    if (scrapeRaw.error) console.error('price_scrape_cache', scrapeRaw.error);
    if (seoPublished.error) console.error('seo_product_pages', seoPublished.error);
    if (premiumActive.error) console.error('user_premium', premiumActive.error);
    if (trialsActive.error) console.error('trial_claims', trialsActive.error);
    if (edgeRaw.error) console.error('edge_request_log', edgeRaw.error);
    if (funnelRaw.error) console.error('telemetry_events funnel', funnelRaw.error);
    if (opsRaw.error) console.error('telemetry_events ops', opsRaw.error);

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

    const alertThreshold = resolveSearchSuccessAlertThreshold(Deno.env);
    const searchSuccess24h = evaluateSearchSuccessAlerts(
      (search24h.data ?? []) as SearchSuccessRate24hRow[],
      alertThreshold,
    );
    const wb = searchSuccess24h.byMarketplace.find((r) => r.marketplace === 'wildberries');
    const wbRate = wb?.successRatePct ?? 100;
    const wbAlert = Boolean(wb?.alert);

    const opsRows = (opsRaw.data ?? []) as OpsRow[];
    const operational = aggregateOperationalMetrics(opsRows);
    const economics = buildEconomicsDashboard(
      {
        monitoringUsers: monitoringInventory.monitoringUsers,
        activeMonitoredProducts: monitoringInventory.activeMonitoredProducts,
        uniqueMonitoringTargets: monitoringInventory.uniqueMonitoringTargets,
        avgSubscribersPerTarget: monitoringInventory.avgSubscribersPerTarget,
        maxSubscribersPerTarget: monitoringInventory.maxSubscribersPerTarget,
        totalSubscriberLinks: monitoringInventory.totalSubscriberLinks,
      },
      {
        monitorChecks: operational.totals.monitorCheck,
        monitorScrapes: operational.totals.monitorScrape,
        monitorCacheHits: operational.totals.monitorCacheHit,
        monitorErrors: operational.totals.monitorError,
        clientScrapeRequests: operational.totals.scrapeRequest,
        scrappeyMonitorScrapes: countScrappeyMonitorScrapes(opsRows),
      },
      periodDays,
    );

    return jsonResponse({
      ok: true,
      generatedAt: new Date().toISOString(),
      periodDays,
      searchDaily: daily.data ?? [],
      searchWeekly: weekly.data ?? [],
      aiRequests: ai.data ?? [],
      searchSuccessRate24h: searchSuccess24h.byMarketplace,
      // Legacy WB card shape for older clients
      wbSuccessRate24h: wb
        ? {
            total_requests: wb.totalRequests,
            successful_requests: wb.successfulRequests,
            success_rate_pct: wb.successRatePct,
            avg_response_time_ms: wb.avgResponseTimeMs,
          }
        : null,
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
        lowSearchSuccessRate: searchSuccess24h.alert,
        alertingMarketplaces: searchSuccess24h.alerting.map((a) => a.marketplace),
        thresholdPct: alertThreshold,
        // Legacy WB-only flags
        wbLowSuccessRate: wbAlert,
        wbSuccessRatePct: wbRate,
      },
      productFunnel: aggregateProductFunnel((funnelRaw.data ?? []) as FunnelRow[]),
      operational,
      monitoringInventory,
      economics,
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
