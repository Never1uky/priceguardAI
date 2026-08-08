/**
 * Pure helpers for seo-publish orchestration.
 */

import { resolveSeoSlugCollision } from './seo-slug.ts';

export type SeoPublishSkipReason = 'unchanged' | 'rejected' | 'missing_cache';

export interface SeoPublishResult {
  ok: boolean;
  slug?: string;
  skipped?: SeoPublishSkipReason;
  rejectReason?: string;
  revalidatePaths?: string[];
  published?: boolean;
}

export function seoRevalidatePaths(
  slug: string,
  brandSlug?: string | null,
  categorySlug?: string | null,
): string[] {
  const paths = [`/a/${slug}`, '/sitemap.xml', '/rss.xml', '/'];
  if (brandSlug) paths.push(`/brand/${brandSlug}`);
  if (categorySlug) paths.push(`/category/${categorySlug}`);
  return paths;
}

export function countRawReviews(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((r) => {
    if (typeof r === 'string') return r.trim().length > 0;
    if (r && typeof r === 'object') {
      const text = (r as { text?: unknown }).text;
      return typeof text === 'string' && text.trim().length > 0;
    }
    return false;
  }).length;
}

/**
 * Honest marketplace rating from review objects (1–5). Returns null if insufficient data.
 * Never invents AggregateRating from qualityScore.
 */
export function averageMarketplaceRating(raw: unknown): number | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ratings: number[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const n = Number((r as { rating?: unknown }).rating);
    if (Number.isFinite(n) && n >= 1 && n <= 5) ratings.push(n);
  }
  if (ratings.length < 3) return null;
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return Math.round(avg * 10) / 10;
}

export function asAnalysisRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.qualityScore !== 'number') return null;
  return obj;
}

export function analyzedAtToIso(analysis: Record<string, unknown>): string | null {
  const n = analysis.analyzedAt;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
    return new Date(n).toISOString();
  }
  if (typeof n === 'string' && n.trim()) {
    const t = Date.parse(n);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

/**
 * Pick a free slug for productKey. `isTaken(slug)` true if owned by another product.
 */
export async function allocateUniqueSlug(params: {
  desired: string;
  marketplace: string;
  productId: string;
  productKey: string;
  isTakenByOther: (slug: string) => Promise<boolean>;
  maxAttempts?: number;
}): Promise<string> {
  const max = params.maxAttempts ?? 8;
  let attempt = 0;
  let candidate = params.desired;
  while (attempt < max) {
    const taken = await params.isTakenByOther(candidate);
    if (!taken) return candidate;
    candidate = resolveSeoSlugCollision(
      params.desired,
      true,
      params.marketplace,
      params.productId,
      attempt,
    );
    attempt += 1;
  }
  return resolveSeoSlugCollision(
    params.desired,
    true,
    params.marketplace,
    params.productId,
    max,
  );
}

export interface SeoOfferSnapshot {
  marketplace: string;
  productId: string;
  url: string;
  title?: string;
  price: number | null;
  rating?: number | null;
}

export const SEO_MAX_OFFERS = 6;

function offerKey(o: SeoOfferSnapshot): string {
  return `${o.marketplace}:${o.productId}`;
}

/** Merge offers by marketplace:productId; prefer entries with price. */
export function mergeSeoOffers(
  ...lists: SeoOfferSnapshot[][]
): SeoOfferSnapshot[] {
  const map = new Map<string, SeoOfferSnapshot>();
  for (const list of lists) {
    for (const o of list) {
      if (!o?.marketplace || !o.productId) continue;
      const k = offerKey(o);
      const prev = map.get(k);
      if (!prev) {
        map.set(k, o);
        continue;
      }
      if ((prev.price == null || prev.price <= 0) && o.price != null && o.price > 0) {
        map.set(k, o);
      } else if (!prev.url && o.url) {
        map.set(k, { ...prev, url: o.url });
      }
    }
  }
  return [...map.values()].slice(0, SEO_MAX_OFFERS);
}
