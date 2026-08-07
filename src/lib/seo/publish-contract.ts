/**
 * Spec-level publish job steps (docs/SEO_PRODUCT_PAGES.md §3).
 * Implementation will live in Edge `seo-publish`; this documents the contract in code.
 */

export const SEO_PUBLISH_TRIGGER = {
  /** Only after product_cache cache_version = 2 upsert */
  cacheVersion: 2,
  /** Never call ai-proxy / generate from this path */
  allowAiGenerate: false,
} as const;

export type SeoPublishSkipReason = 'unchanged' | 'rejected' | 'missing_cache';

export interface SeoPublishResult {
  ok: boolean;
  slug?: string;
  skipped?: SeoPublishSkipReason;
  rejectReason?: string;
  revalidatePaths?: string[];
}

/**
 * Paths to on-demand revalidate after a successful published upsert.
 */
export function seoRevalidatePaths(slug: string, brandSlug?: string | null, categorySlug?: string | null): string[] {
  const paths = [`/a/${slug}`, '/sitemap.xml', '/rss.xml', '/'];
  if (brandSlug) paths.push(`/brand/${brandSlug}`);
  if (categorySlug) paths.push(`/category/${categorySlug}`);
  return paths;
}
