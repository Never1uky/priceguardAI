/**
 * Server marketplace feature flags (Phase 10) — extension client.
 * Fetched from Edge `marketplace-flags`; cached locally 1h.
 * On fetch failure: conservative allowlist = core trio only.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import {
  COMPARISON_MARKETPLACE_IDS,
  DEFAULT_SEARCH_MARKETPLACE_IDS,
  isMarketplaceId,
  type MarketplaceId,
} from '@/lib/marketplaces/registry';

export interface ServerMarketplaceFlagRow {
  marketplace_enabled: boolean;
  monitoring_enabled: boolean;
}

export type ServerMarketplaceFlagsMap = Partial<Record<MarketplaceId, ServerMarketplaceFlagRow>>;

const CACHE_KEY = 'priceguard_server_mp_flags_v1';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedServerFlags {
  flags: ServerMarketplaceFlagsMap;
  fetchedAt: number;
}

export async function loadServerMarketplaceFlags(
  force = false,
): Promise<ServerMarketplaceFlagsMap | null> {
  if (!force) {
    try {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      const cached = stored[CACHE_KEY] as CachedServerFlags | undefined;
      if (cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.flags;
      }
    } catch {
      // soft
    }
  }

  const resp = await callEdgeSafe<{
    ok?: boolean;
    flags?: Record<string, ServerMarketplaceFlagRow>;
  }>('marketplace-flags', {});

  if (!resp?.ok || !resp.flags) return null;

  const flags: ServerMarketplaceFlagsMap = {};
  for (const [id, row] of Object.entries(resp.flags)) {
    if (!isMarketplaceId(id)) continue;
    flags[id] = row;
  }

  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { flags, fetchedAt: Date.now() } satisfies CachedServerFlags,
    });
  } catch {
    // soft
  }

  return flags;
}

/** Compare allowlist from server; null flags → core trio only. */
export function serverCompareAllowlist(flags: ServerMarketplaceFlagsMap | null): MarketplaceId[] {
  if (!flags) return [...DEFAULT_SEARCH_MARKETPLACE_IDS];
  return COMPARISON_MARKETPLACE_IDS.filter((id) => flags[id]?.marketplace_enabled);
}

export function isServerCompareEnabled(
  flags: ServerMarketplaceFlagsMap | null,
  id: MarketplaceId,
): boolean {
  if (!flags) return DEFAULT_SEARCH_MARKETPLACE_IDS.includes(id);
  return Boolean(flags[id]?.marketplace_enabled);
}

export function filterSelectedByServerFlags(
  selected: MarketplaceId[],
  flags: ServerMarketplaceFlagsMap | null,
): MarketplaceId[] {
  const allow = new Set(serverCompareAllowlist(flags));
  const filtered = selected.filter((id) => allow.has(id));
  if (filtered.length) return filtered;
  const fallback = serverCompareAllowlist(flags);
  return fallback.length ? fallback : [...DEFAULT_SEARCH_MARKETPLACE_IDS];
}
