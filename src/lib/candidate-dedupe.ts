/**
 * Dedupe SERP / picker candidates by marketplace product identity.
 * Same YM product under different slugs (/product--a/123 vs /product--b/123)
 * must collapse to one row before needs_choice / auto-pick.
 */
import type { ComparisonMarketplace } from '@/types/comparison';
import { extractComparisonArticle, normalizeCompareUrl } from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';

/** Stable key: prefer marketplace:article, else canonical URL. */
export function candidateDedupeKey(
  marketplace: ComparisonMarketplace,
  url: string,
): string {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return '';
  const article = extractComparisonArticle(trimmed, marketplace).trim();
  if (article) return `${marketplace}:${article}`;
  try {
    return normalizeCompareUrl(toCanonicalProductUrl(trimmed, marketplace));
  } catch {
    return trimmed.split('?')[0].split('#')[0];
  }
}

/**
 * Keep first-best per identity. `score` higher wins; on tie keep earlier item.
 * Rewrites url to canonical when possible.
 */
export function dedupeByCandidateIdentity<T>(
  marketplace: ComparisonMarketplace,
  items: T[],
  getUrl: (item: T) => string,
  score: (item: T) => number = () => 0,
  rewriteUrl?: (item: T, canonicalUrl: string) => T,
): T[] {
  const best = new Map<string, T>();
  const order: string[] = [];

  for (const item of items) {
    const rawUrl = getUrl(item);
    const key = candidateDedupeKey(marketplace, rawUrl);
    if (!key) continue;

    let canonical = rawUrl;
    try {
      canonical = toCanonicalProductUrl(rawUrl, marketplace);
    } catch {
      canonical = rawUrl.split('?')[0].split('#')[0];
    }
    const next = rewriteUrl ? rewriteUrl(item, canonical) : item;

    const prev = best.get(key);
    if (!prev) {
      best.set(key, next);
      order.push(key);
      continue;
    }
    if (score(next) > score(prev)) {
      best.set(key, next);
    }
  }

  return order.map((k) => best.get(k)!).filter(Boolean);
}
