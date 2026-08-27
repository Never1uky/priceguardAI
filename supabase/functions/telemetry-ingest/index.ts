/**
 * Opt-in batch ingest for WARN/ERROR and allowlisted product-funnel INFO.
 * Funnel payloads are stripped to a privacy allowlist; product_id is never stored for funnel.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import {
  isOpsEventName,
  sanitizeOpsPayload,
} from '../_shared/ops-telemetry.ts';

const MAX_BATCH = 25;

const ALLOWED_MARKETPLACES = new Set([
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
  'dns',
  'citilink',
  'eldorado', // legacy events remap to mvideo in row builder
  'lamoda',
]);

const FUNNEL_NAMES = new Set([
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
]);

const FUNNEL_PAYLOAD_KEYS = new Set([
  'reason',
  'outcome',
  'ok',
  'mode',
  'cache',
  'is_first',
  'plan',
  'source',
  'provider',
  'failure_reason',
  'result_type',
  'duration_bucket',
  'install_id',
]);

const SENSITIVE_KEY =
  /url|title|review|product[_-]?id|email|cookie|prompt|license|chat|password|token|pan/i;

function isFunnelEvent(name: string, funnelFlag: unknown): boolean {
  return Boolean(funnelFlag) || FUNNEL_NAMES.has(name);
}

function isOpsEvent(name: string, opsFlag: unknown): boolean {
  return Boolean(opsFlag) || isOpsEventName(name);
}

function sanitizeFunnelPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (!FUNNEL_PAYLOAD_KEYS.has(key)) continue;
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const authUser = await requireAuthUser(req, false);
    const body = await req.json();
    const events = Array.isArray(body.events) ? body.events : [];
    if (!events.length) {
      return jsonResponse({ ok: false, error: 'events required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const rows = events.slice(0, MAX_BATCH).map((e: Record<string, unknown>) => {
      const name = String(e.name ?? 'event').slice(0, 64);
      const funnel = isFunnelEvent(name, e.funnel);
      const ops = isOpsEvent(name, e.ops);
      const rawPayload = e.data && typeof e.data === 'object' ? e.data : null;
      return {
        user_id: authUser?.id ?? null,
        level: String(e.level ?? (funnel || ops ? 'info' : 'warn')).slice(0, 16),
        stage: String(e.stage ?? 'system').slice(0, 32),
        name,
        marketplace:
          typeof e.marketplace === 'string' && ALLOWED_MARKETPLACES.has(e.marketplace)
            ? e.marketplace === 'eldorado'
              ? 'mvideo'
              : e.marketplace
            : null,
        product_id: funnel || ops ? null : e.productId ? String(e.productId).slice(0, 64) : null,
        query_hash: funnel || ops ? null : e.queryHash ? String(e.queryHash).slice(0, 32) : null,
        success: typeof e.success === 'boolean' ? e.success : null,
        elapsed_ms: e.elapsedMs == null ? null : Math.round(Number(e.elapsedMs)),
        error_code: e.errorCode ? String(e.errorCode).slice(0, 64) : null,
        error_message: funnel || ops
          ? null
          : e.errorMessage
            ? String(e.errorMessage).slice(0, 300)
            : null,
        ext_version: e.extVersion ? String(e.extVersion).slice(0, 32) : null,
        session_id: e.sessionId ? String(e.sessionId).slice(0, 64) : null,
        trace_id: e.traceId ? String(e.traceId).slice(0, 64) : null,
        payload: funnel
          ? sanitizeFunnelPayload(rawPayload)
          : ops
            ? sanitizeOpsPayload(rawPayload)
            : rawPayload,
        client_ts: e.ts ? new Date(Number(e.ts)).toISOString() : null,
      };
    });

    const { error } = await supabase.from('telemetry_events').insert(rows);
    if (error) {
      console.error('[telemetry-ingest]', error);
      return jsonResponse({ ok: false, error: 'Insert failed' }, 500);
    }

    return jsonResponse({ ok: true, inserted: rows.length });
  } catch (error) {
    console.error('[telemetry-ingest]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
