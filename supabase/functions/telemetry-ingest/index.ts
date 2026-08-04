/**
 * Opt-in batch ingest for WARN/ERROR telemetry events.
 * Auth: JWT preferred; anonymous soft-fail with device-less insert still allowed if authenticated fails? Prefer JWT.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

const MAX_BATCH = 25;

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

    const rows = events.slice(0, MAX_BATCH).map((e: Record<string, unknown>) => ({
      user_id: authUser?.id ?? null,
      level: String(e.level ?? 'warn').slice(0, 16),
      stage: String(e.stage ?? 'system').slice(0, 32),
      name: String(e.name ?? 'event').slice(0, 64),
      marketplace:
        e.marketplace === 'wildberries' || e.marketplace === 'ozon' || e.marketplace === 'yandex_market'
          ? e.marketplace
          : null,
      product_id: e.productId ? String(e.productId).slice(0, 64) : null,
      query_hash: e.queryHash ? String(e.queryHash).slice(0, 32) : null,
      success: typeof e.success === 'boolean' ? e.success : null,
      elapsed_ms: e.elapsedMs == null ? null : Math.round(Number(e.elapsedMs)),
      error_code: e.errorCode ? String(e.errorCode).slice(0, 64) : null,
      error_message: e.errorMessage ? String(e.errorMessage).slice(0, 300) : null,
      ext_version: e.extVersion ? String(e.extVersion).slice(0, 32) : null,
      session_id: e.sessionId ? String(e.sessionId).slice(0, 64) : null,
      trace_id: e.traceId ? String(e.traceId).slice(0, 64) : null,
      payload: e.data && typeof e.data === 'object' ? e.data : null,
      client_ts: e.ts ? new Date(Number(e.ts)).toISOString() : null,
    }));

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
