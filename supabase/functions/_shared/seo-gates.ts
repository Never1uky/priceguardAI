/**
 * SEO publish quality gates (docs/SEO_PRODUCT_PAGES.md + P2).
 * Mirror of src/lib/seo/publish-gates.ts for Edge Deno.
 */

import { seoTitleStripAlternation } from './seo-marketplaces.ts';

export const SEO_MIN_REVIEWS = 5;
export const SEO_MIN_WEB_OVERVIEW_LEN = 80;
export const SEO_MIN_QUALITY_SCORE = 6;
export const SEO_FEATURED_QUALITY_SCORE = 7;
export const SEO_MIN_PROS = 2;
export const SEO_MIN_CONS = 1;
export const SEO_MIN_TITLE_LEN = 8;

export type SeoRejectReason =
  | 'empty_analysis'
  | 'insufficient_reviews'
  | 'low_quality'
  | 'local_source'
  | 'thin_content'
  | 'weak_title';

export interface SeoGateAnalysis {
  qualityScore?: number | null;
  qualitySummary?: string | null;
  verdictExplanation?: string | null;
  verdict?: string | null;
  fakeRisk?: string | null;
  webOverview?: string | null;
  source?: string | null;
  pros?: unknown;
  cons?: unknown;
}

export interface SeoGateInput {
  analysis: SeoGateAnalysis;
  reviewCount: number;
  title?: string | null;
  featuredOnly?: boolean;
}

export interface SeoGateResult {
  ok: boolean;
  reason?: SeoRejectReason;
}

const VERDICTS = new Set(['buy_now', 'wait_discount', 'not_recommended']);
const FAKE_RISKS = new Set(['low', 'medium', 'high']);

function nonEmpty(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

function asTrimmedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

export function isWeakSeoTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim();
  if (t.length < SEO_MIN_TITLE_LEN) return true;
  if (/\bSEO\s*Smoke\b/i.test(t)) return true;
  if (/\b(smoke\s*fixture|test\s*fixture)\b/i.test(t)) return true;
  if (/^(test|fixture|asdf|xxx)\b/i.test(t)) return true;
  if (/^\d{5,}$/.test(t)) return true;
  if (/^[a-z0-9_-]{6,}$/i.test(t) && !/\s/.test(t) && t.length < 20) return true;
  return false;
}

/**
 * Strip fixture / debug / marketplace suffixes before storing SEO titles.
 * Does not invent a product name — empty means caller must fall back.
 */
export function sanitizeSeoProductTitle(raw: string | null | undefined): string {
  let t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const mp = seoTitleStripAlternation();
  t = t
    .replace(/\bSEO\s*Smoke\b/gi, ' ')
    .replace(/\b(smoke\s*fixture|test\s*fixture|debug|test\s*only)\b/gi, ' ')
    .replace(new RegExp(`\\s*[|·•\\-–—]\\s*(${mp})\\s*$`, 'i'), '')
    .replace(new RegExp(`^\\s*(${mp})\\s*[|·•\\-–—:]\\s*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/**
 * AI contract is 1–10. Legacy mistaken *10 values (11–100) are normalized down.
 * Returns null when score is missing/invalid — never invents a score.
 */
export function normalizeQualityScoreForSeo(
  score: number | null | undefined,
): number | null {
  if (score == null || !Number.isFinite(Number(score))) return null;
  let n = Number(score);
  if (n > 10 && n <= 100) n = n / 10;
  if (n < 1 || n > 10) return null;
  return Math.round(n * 10) / 10;
}

/** Valid http(s) image URL, else null (treats '', whitespace, non-http as absent). */
export function normalizeSeoImageUrl(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/** First valid https image; never invents a URL. Prefer already-published image. */
export function pickSeoImageUrl(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    const n = normalizeSeoImageUrl(c);
    if (n) return n;
  }
  return null;
}

/** Honest image hint from analysis snapshot if present. */
export function imageUrlFromSeoAnalysis(
  analysis: Record<string, unknown> | null | undefined,
): string | null {
  if (!analysis) return null;
  for (const key of ['imageUrl', 'image_url']) {
    const v = analysis[key];
    if (typeof v === 'string') {
      const n = normalizeSeoImageUrl(v);
      if (n) return n;
    }
  }
  return null;
}

export function evaluateSeoPublishGates(input: SeoGateInput): SeoGateResult {
  const a = input.analysis;
  const score = normalizeQualityScoreForSeo(a.qualityScore);

  if (
    score == null ||
    !nonEmpty(a.qualitySummary) ||
    !nonEmpty(a.verdictExplanation) ||
    !a.verdict ||
    !VERDICTS.has(a.verdict) ||
    !a.fakeRisk ||
    !FAKE_RISKS.has(a.fakeRisk)
  ) {
    return { ok: false, reason: 'empty_analysis' };
  }

  if (a.source === 'local') {
    return { ok: false, reason: 'local_source' };
  }

  const minScore = input.featuredOnly
    ? SEO_FEATURED_QUALITY_SCORE
    : SEO_MIN_QUALITY_SCORE;
  if (score < minScore) {
    return { ok: false, reason: 'low_quality' };
  }

  const webLen = (a.webOverview ?? '').trim().length;
  if (input.reviewCount < SEO_MIN_REVIEWS && webLen < SEO_MIN_WEB_OVERVIEW_LEN) {
    return { ok: false, reason: 'insufficient_reviews' };
  }

  const pros = asTrimmedList(a.pros);
  const cons = asTrimmedList(a.cons);
  if (pros.length < SEO_MIN_PROS || cons.length < SEO_MIN_CONS) {
    return { ok: false, reason: 'thin_content' };
  }

  if (input.title != null) {
    const clean = sanitizeSeoProductTitle(input.title) || input.title.trim();
    if (isWeakSeoTitle(clean)) {
      return { ok: false, reason: 'weak_title' };
    }
  }

  return { ok: true };
}
