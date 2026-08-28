/**
 * Server cost guards for Telegram monitoring / Scrappey.
 * Priority: env kill-switches > DB row `monitoring_cost_guards` > defaults.
 * Users cannot raise limits from the extension.
 *
 * MEGA-3 / ALI-3 / MVIDEO-3: Scrappey allowlist may include `megamarket` +
 * `aliexpress` + `mvideo` (Premium card unlocker). Monitoring allowlist stays
 * CORE trio only — never auto-add Mega/Ali/M.Video.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/** Telegram / update-prices cron — Mega/Ali/M.Video never here without a separate RFC. */
export type MonitoringMarketplace = 'wildberries' | 'ozon' | 'yandex_market';

/** Scrappey unlocker / fetch-product-price — Mega + Ali + M.Video allowed for card-only Premium. */
export type ScrappeyMarketplace =
  | MonitoringMarketplace
  | 'megamarket'
  | 'aliexpress'
  | 'mvideo';

const MONITORING_ALLOWED: readonly MonitoringMarketplace[] = [
  'wildberries',
  'ozon',
  'yandex_market',
];

const SCRAPPEY_ALLOWED: readonly ScrappeyMarketplace[] = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
];

export interface CostGuards {
  freeTrackLimit: number;
  premiumTrackLimit: number;
  freshMsFree: number;
  freshMsPremium: number;
  scrappeyEnabled: boolean;
  monitoringMarketplaces: MonitoringMarketplace[];
  scrappeyMarketplaces: ScrappeyMarketplace[];
  priceCacheTtlMs: number;
  scrappeyCircuitAfter: number;
  maxGroupsPerRun: number;
  source: 'defaults' | 'db' | 'env_overlay';
}

export const DEFAULT_COST_GUARDS: CostGuards = {
  freeTrackLimit: 5,
  premiumTrackLimit: 50,
  freshMsFree: 6 * 60 * 60 * 1000,
  freshMsPremium: 3 * 60 * 60 * 1000,
  scrappeyEnabled: true,
  monitoringMarketplaces: [...MONITORING_ALLOWED],
  scrappeyMarketplaces: [...SCRAPPEY_ALLOWED],
  priceCacheTtlMs: 6 * 60 * 60 * 1000,
  scrappeyCircuitAfter: 8,
  maxGroupsPerRun: 160,
  source: 'defaults',
};

function parseMonitoringMpList(raw: unknown): MonitoringMarketplace[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MonitoringMarketplace[] = [];
  for (const item of raw) {
    const s = String(item ?? '').trim();
    if (
      (MONITORING_ALLOWED as readonly string[]).includes(s) &&
      !out.includes(s as MonitoringMarketplace)
    ) {
      out.push(s as MonitoringMarketplace);
    }
  }
  return out;
}

function parseScrappeyMpList(raw: unknown): ScrappeyMarketplace[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ScrappeyMarketplace[] = [];
  for (const item of raw) {
    const s = String(item ?? '').trim();
    if (
      (SCRAPPEY_ALLOWED as readonly string[]).includes(s) &&
      !out.includes(s as ScrappeyMarketplace)
    ) {
      out.push(s as ScrappeyMarketplace);
    }
  }
  return out;
}

function parseEnvMpListFromMap(
  env: Record<string, string | undefined>,
  key: string,
  kind: 'monitoring' | 'scrappey',
): MonitoringMarketplace[] | ScrappeyMarketplace[] | null {
  const raw = env[key]?.trim();
  if (!raw) return null;
  const parts = raw.split(/[,;\s]+/).filter(Boolean);
  return kind === 'monitoring'
    ? parseMonitoringMpList(parts)
    : parseScrappeyMpList(parts);
}

function positiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function positiveBig(raw: unknown, fallback: number, min: number): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

/** Pure merge for unit tests (no Deno env). */
export function mergeCostGuards(
  base: CostGuards,
  row: Record<string, unknown> | null | undefined,
  env: Record<string, string | undefined>,
): CostGuards {
  let g: CostGuards = {
    ...base,
    monitoringMarketplaces: [...base.monitoringMarketplaces],
    scrappeyMarketplaces: [...base.scrappeyMarketplaces],
  };
  let source: CostGuards['source'] = base.source;

  if (row) {
    source = 'db';
    g = {
      ...g,
      freeTrackLimit: positiveInt(row.free_track_limit, g.freeTrackLimit, 0, 500),
      premiumTrackLimit: positiveInt(row.premium_track_limit, g.premiumTrackLimit, 0, 500),
      freshMsFree: positiveBig(row.fresh_ms_free, g.freshMsFree, 600_000),
      freshMsPremium: positiveBig(row.fresh_ms_premium, g.freshMsPremium, 600_000),
      scrappeyEnabled: row.scrappey_enabled == null ? g.scrappeyEnabled : Boolean(row.scrappey_enabled),
      monitoringMarketplaces:
        parseMonitoringMpList(row.monitoring_marketplaces) ?? g.monitoringMarketplaces,
      scrappeyMarketplaces:
        parseScrappeyMpList(row.scrappey_marketplaces) ?? g.scrappeyMarketplaces,
      priceCacheTtlMs: positiveBig(row.price_cache_ttl_ms, g.priceCacheTtlMs, 300_000),
      scrappeyCircuitAfter: positiveInt(row.scrappey_circuit_after, g.scrappeyCircuitAfter, 1, 1000),
      maxGroupsPerRun: positiveInt(row.max_groups_per_run, g.maxGroupsPerRun, 1, 2000),
      source,
    };
  }

  let envTouched = false;
  const scrappeyEnv = env.COST_GUARDS_SCRAPPEY_ENABLED ?? env.SCRAPPEY_ENABLED;
  if (scrappeyEnv != null && scrappeyEnv !== '') {
    envTouched = true;
    g.scrappeyEnabled = !/^(0|false|off|no)$/i.test(scrappeyEnv.trim());
  }

  const mon = parseEnvMpListFromMap(env, 'COST_GUARDS_MONITORING_MARKETPLACES', 'monitoring');
  if (mon) {
    envTouched = true;
    g.monitoringMarketplaces = mon as MonitoringMarketplace[];
  }
  const scrappeyMp = parseEnvMpListFromMap(env, 'COST_GUARDS_SCRAPPEY_MARKETPLACES', 'scrappey');
  if (scrappeyMp) {
    envTouched = true;
    g.scrappeyMarketplaces = scrappeyMp as ScrappeyMarketplace[];
  }

  const freeLim = env.COST_GUARDS_FREE_TRACK_LIMIT;
  if (freeLim != null && freeLim !== '') {
    envTouched = true;
    g.freeTrackLimit = positiveInt(freeLim, g.freeTrackLimit, 0, 500);
  }
  const premLim = env.COST_GUARDS_PREMIUM_TRACK_LIMIT;
  if (premLim != null && premLim !== '') {
    envTouched = true;
    g.premiumTrackLimit = positiveInt(premLim, g.premiumTrackLimit, 0, 500);
  }
  const freshFree = env.COST_GUARDS_FRESH_MS_FREE;
  if (freshFree != null && freshFree !== '') {
    envTouched = true;
    g.freshMsFree = positiveBig(freshFree, g.freshMsFree, 600_000);
  }
  const freshPrem = env.COST_GUARDS_FRESH_MS_PREMIUM;
  if (freshPrem != null && freshPrem !== '') {
    envTouched = true;
    g.freshMsPremium = positiveBig(freshPrem, g.freshMsPremium, 600_000);
  }
  const ttl = env.COST_GUARDS_PRICE_CACHE_TTL_MS;
  if (ttl != null && ttl !== '') {
    envTouched = true;
    g.priceCacheTtlMs = positiveBig(ttl, g.priceCacheTtlMs, 300_000);
  }

  if (envTouched) g.source = 'env_overlay';
  return g;
}

function denoEnvMap(): Record<string, string | undefined> {
  return {
    COST_GUARDS_SCRAPPEY_ENABLED: Deno.env.get('COST_GUARDS_SCRAPPEY_ENABLED'),
    SCRAPPEY_ENABLED: Deno.env.get('SCRAPPEY_ENABLED'),
    COST_GUARDS_MONITORING_MARKETPLACES: Deno.env.get('COST_GUARDS_MONITORING_MARKETPLACES'),
    COST_GUARDS_SCRAPPEY_MARKETPLACES: Deno.env.get('COST_GUARDS_SCRAPPEY_MARKETPLACES'),
    COST_GUARDS_FREE_TRACK_LIMIT: Deno.env.get('COST_GUARDS_FREE_TRACK_LIMIT'),
    COST_GUARDS_PREMIUM_TRACK_LIMIT: Deno.env.get('COST_GUARDS_PREMIUM_TRACK_LIMIT'),
    COST_GUARDS_FRESH_MS_FREE: Deno.env.get('COST_GUARDS_FRESH_MS_FREE'),
    COST_GUARDS_FRESH_MS_PREMIUM: Deno.env.get('COST_GUARDS_FRESH_MS_PREMIUM'),
    COST_GUARDS_PRICE_CACHE_TTL_MS: Deno.env.get('COST_GUARDS_PRICE_CACHE_TTL_MS'),
  };
}

export async function loadCostGuards(supabase: SupabaseClient | null): Promise<CostGuards> {
  let row: Record<string, unknown> | null = null;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('monitoring_cost_guards')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (!error && data) row = data as Record<string, unknown>;
    } catch (e) {
      console.warn('[cost-guards] load failed', e);
    }
  }
  return mergeCostGuards(DEFAULT_COST_GUARDS, row, denoEnvMap());
}

export function trackLimitForPlan(guards: CostGuards, premium: boolean): number {
  return premium ? guards.premiumTrackLimit : guards.freeTrackLimit;
}

export function isMonitoringMarketplace(guards: CostGuards, mp: string): boolean {
  return guards.monitoringMarketplaces.includes(mp as MonitoringMarketplace);
}

export function isScrappeyMarketplace(guards: CostGuards, mp: string): boolean {
  return guards.scrappeyEnabled && guards.scrappeyMarketplaces.includes(mp as ScrappeyMarketplace);
}

/** Credentials only when Scrappey globally on and MP allowed. */
export function scraperForMarketplace(
  guards: CostGuards,
  marketplace: string,
  projectScraper: { apiKey: string } | null,
): { apiKey: string } | null {
  if (!projectScraper?.apiKey) return null;
  if (!isScrappeyMarketplace(guards, marketplace)) return null;
  return projectScraper;
}
