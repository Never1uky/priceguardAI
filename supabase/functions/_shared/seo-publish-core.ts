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
  return raw.filter((r) => typeof r === 'string' && r.trim().length > 0).length;
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
