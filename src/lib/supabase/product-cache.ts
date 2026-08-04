/**
 * Клиентский слой общего кэша отзывов и AI-анализа (Supabase product_cache).
 *
 * Цель: экономия токенов Grok/GPT — если другой пользователь уже проанализировал
 * этот товар, берём результат из общего кэша, не обращаясь к AI.
 *
 * Логика cache-first с TTL реализована в вызывающем коде (background):
 *   1. getRemoteProductCache → если свежий ai_analysis, вернуть его.
 *   2. иначе запросить AI и putRemoteProductCache.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { hashReviews } from '@/lib/review-cache';
import type { Marketplace } from '@/types/product';
import type { FullProductAnalysis, WebResearchSource } from '@/types/full-analysis';
import type { ReviewAnalysisResult } from '@/types/review-analysis';

/** Версия схемы кэша отзывов. Повышать при несовместимых изменениях формата. */
export const PRODUCT_CACHE_VERSION = 1;

/** Отдельная версия для полного AI-анализа товара (не перезаписывает кэш отзывов). */
export const FULL_PRODUCT_CACHE_VERSION = 2;

/** Кэш веб-исследования Sonar (текст + источники). */
export const WEB_RESEARCH_CACHE_VERSION = 3;

/** TTL полного анализа / отзывов — see AI_CACHE_CONFIG.remoteTtlMs */
export const PRODUCT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** TTL веб-исследования (v3) — see AI_CACHE_CONFIG.webResearchTtlMs */
export const WEB_RESEARCH_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface RemoteCacheEntry {
  marketplace: Marketplace;
  productId: string;
  productTitle?: string;
  model?: string;
  rawReviews?: string[];
  aiAnalysis?: ReviewAnalysisResult;
  lastUpdated: number;
  /** true, если запись не старше TTL. */
  fresh: boolean;
}

interface RawCacheRow {
  marketplace: Marketplace;
  product_id: string;
  product_title?: string | null;
  model?: string | null;
  raw_reviews?: string[] | null;
  ai_analysis?: ReviewAnalysisResult | null;
  last_updated: string;
  cache_version: number;
}

/** Прочитать запись общего кэша для товара. */
export async function getRemoteProductCache(
  marketplace: Marketplace,
  productId: string,
): Promise<RemoteCacheEntry | null> {
  if (!productId) return null;

  const res = await callEdgeSafe<{ ok: boolean; entry: RawCacheRow | null }>('product-cache', {
    action: 'get',
    marketplace,
    productId,
    cacheVersion: PRODUCT_CACHE_VERSION,
  });

  const row = res?.entry;
  if (!row) return null;

  const lastUpdated = Date.parse(row.last_updated) || 0;
  return {
    marketplace: row.marketplace,
    productId: row.product_id,
    productTitle: row.product_title ?? undefined,
    model: row.model ?? undefined,
    rawReviews: row.raw_reviews ?? undefined,
    aiAnalysis: row.ai_analysis ?? undefined,
    lastUpdated,
    fresh: Date.now() - lastUpdated < PRODUCT_CACHE_TTL_MS,
  };
}

/** Совпадает ли кэш с текущим набором отзывов */
export function remoteCacheMatchesReviews(
  rawReviews: string[] | undefined,
  reviews: string[],
): boolean {
  if (!rawReviews?.length || !reviews.length) return false;
  return hashReviews(rawReviews) === hashReviews(reviews);
}

/** Прочитать кэш полного AI-анализа. */
export async function getRemoteFullProductCache(
  marketplace: Marketplace,
  productId: string,
): Promise<Omit<RemoteCacheEntry, 'aiAnalysis'> & { aiAnalysis?: FullProductAnalysis } | null> {
  if (!productId) return null;

  const res = await callEdgeSafe<{ ok: boolean; entry: RawCacheRow | null }>('product-cache', {
    action: 'get',
    marketplace,
    productId,
    cacheVersion: FULL_PRODUCT_CACHE_VERSION,
  });

  const row = res?.entry;
  if (!row) return null;

  const lastUpdated = Date.parse(row.last_updated) || 0;
  return {
    marketplace: row.marketplace,
    productId: row.product_id,
    productTitle: row.product_title ?? undefined,
    model: row.model ?? undefined,
    rawReviews: row.raw_reviews ?? undefined,
    aiAnalysis: row.ai_analysis as FullProductAnalysis | undefined,
    lastUpdated,
    fresh: Date.now() - lastUpdated < PRODUCT_CACHE_TTL_MS,
  };
}

export interface RemoteWebResearchEntry {
  marketplace: Marketplace;
  productId: string;
  text: string;
  sources: WebResearchSource[];
  lastUpdated: number;
  fresh: boolean;
}

/** Прочитать кэш веб-исследования Sonar. */
export async function getRemoteWebResearchCache(
  marketplace: Marketplace,
  productId: string,
): Promise<RemoteWebResearchEntry | null> {
  if (!productId) return null;

  const res = await callEdgeSafe<{ ok: boolean; entry: RawCacheRow | null }>('product-cache', {
    action: 'get',
    marketplace,
    productId,
    cacheVersion: WEB_RESEARCH_CACHE_VERSION,
  });

  const row = res?.entry;
  if (!row?.ai_analysis) return null;

  const cached = row.ai_analysis as { text?: string; sources?: WebResearchSource[] };
  if (!cached.text?.trim()) return null;

  const lastUpdated = Date.parse(row.last_updated) || 0;
  return {
    marketplace: row.marketplace,
    productId: row.product_id,
    text: cached.text,
    sources: Array.isArray(cached.sources) ? cached.sources : [],
    lastUpdated,
    fresh: Date.now() - lastUpdated < WEB_RESEARCH_CACHE_TTL_MS,
  };
}

/** Сохранить кэш веб-исследования Sonar. */
export async function putRemoteWebResearchCache(entry: {
  marketplace: Marketplace;
  productId: string;
  productTitle?: string;
  text: string;
  sources?: WebResearchSource[];
}): Promise<void> {
  if (!entry.productId || !entry.text.trim()) return;

  await callEdgeSafe('product-cache', {
    action: 'put',
    marketplace: entry.marketplace,
    productId: entry.productId,
    productTitle: entry.productTitle,
    model: 'sonar',
    aiAnalysis: { text: entry.text, sources: entry.sources ?? [] },
    cacheVersion: WEB_RESEARCH_CACHE_VERSION,
  });
}

/** Сохранить полный AI-анализ в общий кэш. */
export async function putRemoteFullProductCache(entry: {
  marketplace: Marketplace;
  productId: string;
  productTitle?: string;
  model?: string;
  rawReviews?: string[];
  aiAnalysis: FullProductAnalysis;
}): Promise<void> {
  if (!entry.productId) return;

  await callEdgeSafe('product-cache', {
    action: 'put',
    marketplace: entry.marketplace,
    productId: entry.productId,
    productTitle: entry.productTitle,
    model: entry.model,
    rawReviews: entry.rawReviews,
    aiAnalysis: entry.aiAnalysis,
    cacheVersion: FULL_PRODUCT_CACHE_VERSION,
  });
}

/** Сохранить/обновить запись общего кэша отзывов. */
export async function putRemoteProductCache(entry: {
  marketplace: Marketplace;
  productId: string;
  productTitle?: string;
  model?: string;
  rawReviews?: string[];
  aiAnalysis?: ReviewAnalysisResult;
}): Promise<void> {
  if (!entry.productId) return;

  await callEdgeSafe('product-cache', {
    action: 'put',
    marketplace: entry.marketplace,
    productId: entry.productId,
    productTitle: entry.productTitle,
    model: entry.model,
    rawReviews: entry.rawReviews,
    aiAnalysis: entry.aiAnalysis,
    cacheVersion: PRODUCT_CACHE_VERSION,
  });
}
