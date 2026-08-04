/**
 * Локальный кэш веб-исследования Sonar (TTL 14 дней).
 * Ключ: marketplace + productId — не зависит от hash отзывов.
 */

import type { WebResearchSource } from '@/types/full-analysis';
import type { Marketplace } from '@/types/product';
import { WEB_RESEARCH_CACHE_TTL_MS } from '@/lib/supabase/product-cache';

export interface WebResearchCacheEntry {
  text: string;
  sources: WebResearchSource[];
  savedAt: number;
}

const STORAGE_PREFIX = 'priceguard_web_research_';

function cacheKey(marketplace: Marketplace | string, productId: string): string {
  return `${STORAGE_PREFIX}${marketplace}_${productId}`;
}

export function isWebResearchFresh(savedAt: number): boolean {
  return Date.now() - savedAt < WEB_RESEARCH_CACHE_TTL_MS;
}

/** Прочитать локальный кэш веб-исследования. */
export async function getCachedWebResearch(
  marketplace: Marketplace | string,
  productId: string,
): Promise<(WebResearchCacheEntry & { fresh: boolean }) | null> {
  if (!productId) return null;
  const key = cacheKey(marketplace, productId);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as WebResearchCacheEntry | undefined;
  if (!entry?.text?.trim()) return null;
  return {
    text: entry.text,
    sources: Array.isArray(entry.sources) ? entry.sources : [],
    savedAt: entry.savedAt ?? 0,
    fresh: isWebResearchFresh(entry.savedAt ?? 0),
  };
}

/** Сохранить локальный кэш веб-исследования. */
export async function saveCachedWebResearch(
  marketplace: Marketplace | string,
  productId: string,
  data: { text: string; sources?: WebResearchSource[] },
): Promise<void> {
  if (!productId || !data.text.trim()) return;
  const key = cacheKey(marketplace, productId);
  const entry: WebResearchCacheEntry = {
    text: data.text.trim(),
    sources: data.sources ?? [],
    savedAt: Date.now(),
  };
  await chrome.storage.local.set({ [key]: entry });
}
