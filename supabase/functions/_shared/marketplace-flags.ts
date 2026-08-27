/**
 * Server marketplace feature flags (Phase 10).
 * marketplace_enabled — manual compare / search in extension
 * monitoring_enabled — Telegram cron (update-prices)
 *
 * Priority: env JSON overlay > DB rows > code defaults.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import type { Marketplace } from './product-url.ts';

/** All MPs known to extension registry + server ops */
export const KNOWN_MARKETPLACE_IDS = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
  'dns',
  'citilink',
  'lamoda',
] as const;

export type KnownMarketplaceId = (typeof KNOWN_MARKETPLACE_IDS)[number];

export interface MarketplaceFlagRow {
  marketplaceEnabled: boolean;
  monitoringEnabled: boolean;
}

export type MarketplaceFlagsMap = Record<string, MarketplaceFlagRow>;

export interface LoadedMarketplaceFlags {
  flags: MarketplaceFlagsMap;
  source: 'defaults' | 'db' | 'env_overlay';
  updatedAt: string | null;
}

const CORE_TRIO: KnownMarketplaceId[] = ['wildberries', 'ozon', 'yandex_market'];

function defaultFlags(): MarketplaceFlagsMap {
  const out: MarketplaceFlagsMap = {};
  for (const id of KNOWN_MARKETPLACE_IDS) {
    const core = CORE_TRIO.includes(id as KnownMarketplaceId);
    out[id] = {
      marketplaceEnabled: core,
      monitoringEnabled: core,
    };
  }
  return out;
}

function parseEnvFlagsJson(raw: string | undefined): MarketplaceFlagsMap | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: MarketplaceFlagsMap = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (!KNOWN_MARKETPLACE_IDS.includes(key as KnownMarketplaceId)) continue;
      if (val && typeof val === 'object') {
        const o = val as Record<string, unknown>;
        out[key] = {
          marketplaceEnabled: Boolean(o.marketplace_enabled ?? o.marketplaceEnabled),
          monitoringEnabled: Boolean(o.monitoring_enabled ?? o.monitoringEnabled),
        };
      } else if (typeof val === 'boolean') {
        out[key] = { marketplaceEnabled: val, monitoringEnabled: val };
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Pure merge for tests */
export function mergeMarketplaceFlags(
  base: MarketplaceFlagsMap,
  rows: Array<{ marketplace_id: string; marketplace_enabled: boolean; monitoring_enabled: boolean }>,
  envJson?: string,
): LoadedMarketplaceFlags {
  const flags: MarketplaceFlagsMap = { ...defaultFlags(), ...base };
  for (const id of KNOWN_MARKETPLACE_IDS) {
    if (!flags[id]) {
      flags[id] = { marketplaceEnabled: false, monitoringEnabled: false };
    }
  }

  let source: LoadedMarketplaceFlags['source'] = 'defaults';
  let updatedAt: string | null = null;

  if (rows.length > 0) {
    source = 'db';
    for (const row of rows) {
      const id = String(row.marketplace_id ?? '').trim();
      if (!KNOWN_MARKETPLACE_IDS.includes(id as KnownMarketplaceId)) continue;
      flags[id] = {
        marketplaceEnabled: Boolean(row.marketplace_enabled),
        monitoringEnabled: Boolean(row.monitoring_enabled),
      };
    }
  }

  const envOverlay = parseEnvFlagsJson(envJson);
  if (envOverlay) {
    source = 'env_overlay';
    for (const [id, patch] of Object.entries(envOverlay)) {
      flags[id] = { ...flags[id], ...patch };
    }
  }

  return { flags, source, updatedAt };
}

export async function loadMarketplaceFlags(
  supabase: SupabaseClient | null,
): Promise<LoadedMarketplaceFlags> {
  const envJson = Deno.env.get('MARKETPLACE_FLAGS_JSON');
  if (!supabase) {
    return mergeMarketplaceFlags(defaultFlags(), [], envJson);
  }

  try {
    const { data, error } = await supabase
      .from('marketplace_flags')
      .select('marketplace_id, marketplace_enabled, monitoring_enabled, updated_at')
      .order('marketplace_id');

    if (error || !data?.length) {
      return mergeMarketplaceFlags(defaultFlags(), [], envJson);
    }

    const merged = mergeMarketplaceFlags(
      defaultFlags(),
      data.map((r) => ({
        marketplace_id: String(r.marketplace_id),
        marketplace_enabled: Boolean(r.marketplace_enabled),
        monitoring_enabled: Boolean(r.monitoring_enabled),
      })),
      envJson,
    );
    const latest = data
      .map((r) => String(r.updated_at ?? ''))
      .filter(Boolean)
      .sort()
      .pop();
    merged.updatedAt = latest ?? null;
    return merged;
  } catch (e) {
    console.warn('[marketplace-flags] load failed', e);
    return mergeMarketplaceFlags(defaultFlags(), [], envJson);
  }
}

export function isMarketplaceCompareEnabled(
  loaded: LoadedMarketplaceFlags,
  mp: string,
): boolean {
  return Boolean(loaded.flags[mp]?.marketplaceEnabled);
}

/** Telegram monitoring: flag + optional global allowlist intersection */
export function isMarketplaceMonitoringEnabled(
  loaded: LoadedMarketplaceFlags,
  mp: string,
  globalAllowlist?: readonly string[],
): boolean {
  if (!loaded.flags[mp]?.monitoringEnabled) return false;
  if (globalAllowlist?.length && !globalAllowlist.includes(mp)) return false;
  return true;
}

/** Public payload for extension */
export function marketplaceFlagsPublicPayload(
  loaded: LoadedMarketplaceFlags,
): Record<string, { marketplace_enabled: boolean; monitoring_enabled: boolean }> {
  const out: Record<string, { marketplace_enabled: boolean; monitoring_enabled: boolean }> = {};
  for (const id of KNOWN_MARKETPLACE_IDS) {
    const row = loaded.flags[id] ?? { marketplaceEnabled: false, monitoringEnabled: false };
    out[id] = {
      marketplace_enabled: row.marketplaceEnabled,
      monitoring_enabled: row.monitoringEnabled,
    };
  }
  return out;
}

export function coreMonitoringMarketplaces(
  loaded: LoadedMarketplaceFlags,
  globalAllowlist?: readonly string[],
): Marketplace[] {
  return CORE_TRIO.filter((mp) =>
    isMarketplaceMonitoringEnabled(loaded, mp, globalAllowlist)
  ) as Marketplace[];
}

/** Per-MP flag ∧ optional cost-guards global allowlist (Phase 9 ∩ Phase 10). */
export function isMonitoringAllowed(
  loaded: LoadedMarketplaceFlags,
  mp: string,
  globalAllowlist?: readonly string[],
): boolean {
  return isMarketplaceMonitoringEnabled(loaded, mp, globalAllowlist);
}
