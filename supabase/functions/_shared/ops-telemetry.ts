/**
 * Phase 11 operational telemetry — privacy-safe, no PII.
 * Server inserts directly; client events ingested via telemetry-ingest with ops allowlist.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export const OPS_EVENT_NAMES = [
  'marketplace_search_started',
  'marketplace_search_success',
  'marketplace_search_failed',
  'scrape_request',
  'scrape_cache_hit',
  'scrape_cache_miss',
  'telegram_monitor_check',
  'telegram_monitor_cache_hit',
  'telegram_monitor_scrape',
  'telegram_alert_sent',
  'telegram_monitor_error',
] as const;

export type OpsEventName = (typeof OPS_EVENT_NAMES)[number];

const OPS_NAME_SET = new Set<string>(OPS_EVENT_NAMES);

export function isOpsEventName(name: string): boolean {
  return OPS_NAME_SET.has(name);
}

const ALLOWED_MARKETPLACES = new Set([
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
  'dns',
  'citilink',
  'lamoda',
]);

/** Payload keys safe for ops — no urls/titles/chat/product ids */
export const OPS_PAYLOAD_KEYS = new Set([
  'source',
  'path',
  'context',
  'reason',
  'alert_type',
  'subscriber_count',
  'stale_count',
  'scrappey',
]);

const SENSITIVE_KEY =
  /url|title|review|product[_-]?id|email|cookie|prompt|license|chat|password|token|pan|query/i;

export function sanitizeOpsPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (!OPS_PAYLOAD_KEYS.has(key)) continue;
    if (value == null) continue;
    if (typeof value === 'string') {
      out[key] = value.slice(0, 64);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

export interface OpsTelemetryInput {
  name: OpsEventName;
  marketplace?: string | null;
  success?: boolean | null;
  elapsed_ms?: number | null;
  error_code?: string | null;
  stage?: string;
  payload?: Record<string, unknown> | null;
}

function normalizeMarketplace(mp: string | null | undefined): string | null {
  if (!mp) return null;
  const id = mp === 'eldorado' ? 'mvideo' : mp;
  return ALLOWED_MARKETPLACES.has(id) ? id : null;
}

export function opsRowFromInput(input: OpsTelemetryInput): Record<string, unknown> {
  return {
    level: 'info',
    stage: (input.stage ?? 'system').slice(0, 32),
    name: input.name,
    marketplace: normalizeMarketplace(input.marketplace),
    product_id: null,
    query_hash: null,
    error_message: null,
    success: typeof input.success === 'boolean' ? input.success : null,
    elapsed_ms:
      input.elapsed_ms == null || !Number.isFinite(input.elapsed_ms)
        ? null
        : Math.round(Number(input.elapsed_ms)),
    error_code: input.error_code ? String(input.error_code).slice(0, 64) : null,
    payload: sanitizeOpsPayload(input.payload),
    client_ts: null,
  };
}

export async function insertOpsTelemetry(
  supabase: SupabaseClient | null,
  events: OpsTelemetryInput[],
): Promise<number> {
  if (!supabase || !events.length) return 0;
  const rows = events.filter((e) => isOpsEventName(e.name)).map(opsRowFromInput);
  if (!rows.length) return 0;
  try {
    const { error } = await supabase.from('telemetry_events').insert(rows);
    if (error) {
      console.warn('[ops-telemetry] insert failed', error.message);
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.warn('[ops-telemetry] insert exception', e);
    return 0;
  }
}

/** Map scrape source to ops events for monitoring context */
export function monitorScrapeOpsEvents(input: {
  marketplace: string;
  source?: 'cache' | 'scrappey' | 'legacy' | null;
  subscriber_count: number;
  stale_count: number;
  scrappey?: boolean;
}): OpsTelemetryInput[] {
  const base = {
    marketplace: input.marketplace,
    payload: {
      subscriber_count: input.subscriber_count,
      stale_count: input.stale_count,
      scrappey: Boolean(input.scrappey),
    },
  };
  const out: OpsTelemetryInput[] = [
    {
      ...base,
      name: 'telegram_monitor_check',
      success: true,
      stage: 'telegram',
    },
  ];
  if (input.stale_count <= 0) return out;
  if (input.source === 'cache') {
    out.push({
      ...base,
      name: 'telegram_monitor_cache_hit',
      success: true,
      stage: 'telegram',
      payload: { ...base.payload, source: 'cache' },
    });
  } else if (input.source) {
    out.push({
      ...base,
      name: 'telegram_monitor_scrape',
      success: true,
      stage: 'telegram',
      payload: { ...base.payload, source: input.source },
    });
  }
  return out;
}
