/**
 * User preference: which marketplaces to search/compare on.
 * chrome.storage.local — same pattern as alert/telemetry settings.
 */

import {
  COMPARISON_MARKETPLACE_IDS,
  DEFAULT_SEARCH_MARKETPLACE_IDS,
  isMarketplaceId,
  type MarketplaceId,
} from '@/lib/marketplaces/registry';
import { migrateLegacyMarketplaceId } from '@/lib/marketplaces/adapter-config';
import {
  filterSelectedByServerFlags,
  loadServerMarketplaceFlags,
} from '@/lib/marketplaces/server-flags';

export const SEARCH_MARKETPLACES_KEY = 'priceguard_search_marketplaces_v1';

export interface SearchMarketplacesSettings {
  /** Selected marketplace ids (order preserved from registry) */
  selected: MarketplaceId[];
}

function uniqueValidIds(raw: unknown): MarketplaceId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<MarketplaceId>();
  const out: MarketplaceId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const migrated = migrateLegacyMarketplaceId(item);
    const id = migrated ?? (isMarketplaceId(item) ? item : null);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Normalize stored value; empty/corrupt → default trio (never empty). */
export function normalizeSearchMarketplaces(raw: unknown): MarketplaceId[] {
  const ids = uniqueValidIds(raw);
  if (!ids.length) return [...DEFAULT_SEARCH_MARKETPLACE_IDS];
  // Keep registry order for stable UI / compare
  return COMPARISON_MARKETPLACE_IDS.filter((id) => ids.includes(id));
}

async function applyServerGate(selected: MarketplaceId[]): Promise<MarketplaceId[]> {
  const flags = await loadServerMarketplaceFlags();
  return filterSelectedByServerFlags(normalizeSearchMarketplaces(selected), flags);
}

export function defaultSearchMarketplacesSettings(): SearchMarketplacesSettings {
  return { selected: [...DEFAULT_SEARCH_MARKETPLACE_IDS] };
}

export async function loadSearchMarketplacesSettings(): Promise<SearchMarketplacesSettings> {
  try {
    const stored = await chrome.storage.local.get(SEARCH_MARKETPLACES_KEY);
    const value = stored[SEARCH_MARKETPLACES_KEY] as
      | SearchMarketplacesSettings
      | MarketplaceId[]
      | undefined;
    if (Array.isArray(value)) {
      return { selected: normalizeSearchMarketplaces(value) };
    }
    if (value && typeof value === 'object' && 'selected' in value) {
      return { selected: normalizeSearchMarketplaces(value.selected) };
    }
  } catch {
    // soft
  }
  return defaultSearchMarketplacesSettings();
}

export async function saveSearchMarketplacesSettings(
  selected: MarketplaceId[],
): Promise<SearchMarketplacesSettings> {
  const gated = await applyServerGate(selected);
  const next: SearchMarketplacesSettings = {
    selected: normalizeSearchMarketplaces(gated),
  };
  await chrome.storage.local.set({ [SEARCH_MARKETPLACES_KEY]: next });
  return next;
}

export async function getSelectedSearchMarketplaces(): Promise<MarketplaceId[]> {
  const settings = await loadSearchMarketplacesSettings();
  return applyServerGate(settings.selected);
}

export async function isMarketplaceSelected(id: MarketplaceId): Promise<boolean> {
  const selected = await getSelectedSearchMarketplaces();
  return selected.includes(id);
}

/**
 * Targets for compare: user selection ∩ optional onlyMarketplaces.
 * Always includes sourceMarketplace so the source row resolves.
 */
export function resolveCompareMarketplaces(opts: {
  selected: MarketplaceId[];
  sourceMarketplace: MarketplaceId;
  onlyMarketplaces?: MarketplaceId[] | null;
}): MarketplaceId[] {
  let base = normalizeSearchMarketplaces(opts.selected);
  if (!base.includes(opts.sourceMarketplace)) {
    base = normalizeSearchMarketplaces([...base, opts.sourceMarketplace]);
  }
  if (opts.onlyMarketplaces?.length) {
    const only = new Set(opts.onlyMarketplaces.filter(isMarketplaceId));
    // Source always kept; targets filtered by only ∩ selected
    return base.filter((id) => id === opts.sourceMarketplace || only.has(id));
  }
  return base;
}
