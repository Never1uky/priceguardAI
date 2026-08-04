/**
 * Кэш результатов поиска (SERP) в chrome.storage.local — TTL 45 мин.
 * Кэшируем только успешные находки / manual pick — не «не найдено».
 */
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';

export const SERP_CACHE_TTL_MS = 45 * 60 * 1000;
const SERP_CACHE_KEY = 'priceguard_serp_cache_v1';
const MAX_ENTRIES = 80;

export interface SerpCacheEntry {
  key: string;
  marketplace: ComparisonMarketplace;
  query: string;
  referenceTitle: string;
  offer: MarketplaceOffer;
  cachedAt: number;
}

type SerpCacheStore = Record<string, SerpCacheEntry>;

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildSerpCacheKey(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
): string {
  return `${marketplace}|${normalizeKeyPart(query)}|${normalizeKeyPart(referenceTitle)}`;
}

/** Можно ли класть оффер в SERP-кэш (не кэшируем пустые notFound). */
export function isCacheableSerpOffer(offer: MarketplaceOffer): boolean {
  if (offer.needsManualPick && (offer.searchCandidates?.length ?? 0) > 0) return true;
  if (!offer.found) return false;
  if (!offer.price || offer.price <= 0) return false;
  return Boolean(offer.url);
}

async function readStore(): Promise<SerpCacheStore> {
  const stored = await chrome.storage.local.get(SERP_CACHE_KEY);
  const raw = stored[SERP_CACHE_KEY];
  return raw && typeof raw === 'object' ? (raw as SerpCacheStore) : {};
}

async function writeStore(store: SerpCacheStore): Promise<void> {
  const entries = Object.values(store).sort((a, b) => b.cachedAt - a.cachedAt);
  const trimmed = entries.slice(0, MAX_ENTRIES);
  const next: SerpCacheStore = {};
  for (const entry of trimmed) {
    next[entry.key] = entry;
  }
  await chrome.storage.local.set({ [SERP_CACHE_KEY]: next });
}

export async function getSerpCachedOffer(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
): Promise<MarketplaceOffer | null> {
  const key = buildSerpCacheKey(marketplace, query, referenceTitle);
  const store = await readStore();
  const entry = store[key];
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > SERP_CACHE_TTL_MS) {
    delete store[key];
    await writeStore(store);
    return null;
  }

  // Старые записи !found — игнорируем и удаляем
  if (!isCacheableSerpOffer(entry.offer)) {
    delete store[key];
    await writeStore(store);
    return null;
  }

  return entry.offer;
}

export async function setSerpCachedOffer(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  offer: MarketplaceOffer,
): Promise<void> {
  if (!isCacheableSerpOffer(offer)) return;

  const key = buildSerpCacheKey(marketplace, query, referenceTitle);
  const store = await readStore();
  store[key] = {
    key,
    marketplace,
    query,
    referenceTitle,
    offer,
    cachedAt: Date.now(),
  };
  await writeStore(store);
}

/** Удалить все notFound / просроченные записи (вызывать при research). */
export async function clearSerpNotFoundAndExpired(): Promise<void> {
  const store = await readStore();
  const now = Date.now();
  let changed = false;

  for (const [key, entry] of Object.entries(store)) {
    if (now - entry.cachedAt > SERP_CACHE_TTL_MS || !isCacheableSerpOffer(entry.offer)) {
      delete store[key];
      changed = true;
    }
  }

  if (changed) {
    await writeStore(store);
  }
}

export async function clearExpiredSerpCache(): Promise<void> {
  await clearSerpNotFoundAndExpired();
}
