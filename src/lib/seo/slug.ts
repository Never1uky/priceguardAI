/**
 * SEO slug + analysis hash helpers (docs/SEO_PRODUCT_PAGES.md).
 */

export const SEO_SLUG_MAX_LEN = 80;

const MP_SHORT: Record<string, string> = {
  wildberries: 'wb',
  ozon: 'ozon',
  yandex_market: 'ym',
};

/** URL-safe slug: lower, ё→е, non-alnum → -, max length. */
export function slugifySeoSegment(raw: string, maxLen = SEO_SLUG_MAX_LEN): string {
  const s = raw
    .normalize('NFKD')
    .replace(/ё/gi, 'е')
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!s) return 'item';
  return s.slice(0, maxLen).replace(/-$/g, '') || 'item';
}

export function buildSeoProductSlug(parts: {
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  year?: string | null;
  marketplace: string;
  productId: string;
}): string {
  const tokens = [parts.brand, parts.model, parts.year, parts.storage]
    .map((t) => (t ?? '').trim())
    .filter(Boolean);
  if (tokens.length >= 2) {
    return slugifySeoSegment(tokens.join(' '));
  }
  const short = MP_SHORT[parts.marketplace] ?? 'mp';
  return slugifySeoSegment(`${short}-${parts.productId}`);
}

export function resolveSeoSlugCollision(
  desired: string,
  takenByOtherProduct: boolean,
  marketplace: string,
  productId: string,
  attempt = 0,
): string {
  if (!takenByOtherProduct && attempt === 0) return desired;
  const short = MP_SHORT[marketplace] ?? 'mp';
  if (attempt === 0) {
    return slugifySeoSegment(`${desired}-${short}`);
  }
  if (attempt === 1) {
    return slugifySeoSegment(`${desired}-${short}-${productId}`).slice(0, SEO_SLUG_MAX_LEN);
  }
  return slugifySeoSegment(`${desired}-${short}-${attempt + 1}`);
}

export function brandOrCategorySlug(label: string | null | undefined): string | null {
  if (!label?.trim()) return null;
  return slugifySeoSegment(label);
}

/** Stable hash input — excludes priceInsight / analyzedAt / providerLabel. */
export function stableAnalysisPayloadForHash(analysis: Record<string, unknown>): unknown {
  return {
    qualityScore: analysis.qualityScore,
    qualitySummary: analysis.qualitySummary,
    webOverview: analysis.webOverview,
    pros: analysis.pros,
    cons: analysis.cons,
    fakeRisk: analysis.fakeRisk,
    fakeRiskExplanation: analysis.fakeRiskExplanation,
    verdict: analysis.verdict,
    verdictExplanation: analysis.verdictExplanation,
    keySpecs: analysis.keySpecs,
    hiddenProblems: analysis.hiddenProblems,
    alternatives: analysis.alternatives,
    analogComparison: analysis.analogComparison,
    source: analysis.source,
  };
}

export async function hashSeoAnalysis(analysis: Record<string, unknown>): Promise<string> {
  const payload = JSON.stringify(stableAnalysisPayloadForHash(analysis));
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function productKey(marketplace: string, productId: string): string {
  return `${marketplace}:${String(productId).trim()}`;
}

export function canonicalPathForSlug(slug: string): string {
  return `/a/${slug}`;
}
