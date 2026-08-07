/**
 * SEO publish quality gates (docs/SEO_PRODUCT_PAGES.md).
 * Mirror of src/lib/seo/publish-gates.ts for Edge Deno.
 */

export const SEO_MIN_REVIEWS = 5;
export const SEO_MIN_WEB_OVERVIEW_LEN = 80;
export const SEO_MIN_QUALITY_SCORE = 6;

export type SeoRejectReason =
  | 'empty_analysis'
  | 'insufficient_reviews'
  | 'low_quality'
  | 'local_source';

export interface SeoGateAnalysis {
  qualityScore?: number | null;
  qualitySummary?: string | null;
  verdictExplanation?: string | null;
  verdict?: string | null;
  fakeRisk?: string | null;
  webOverview?: string | null;
  source?: string | null;
}

export interface SeoGateInput {
  analysis: SeoGateAnalysis;
  reviewCount: number;
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

export function evaluateSeoPublishGates(input: SeoGateInput): SeoGateResult {
  const a = input.analysis;
  const score = a.qualityScore;

  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 1 ||
    score > 10 ||
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

  if (score < SEO_MIN_QUALITY_SCORE) {
    return { ok: false, reason: 'low_quality' };
  }

  const webLen = (a.webOverview ?? '').trim().length;
  if (input.reviewCount < SEO_MIN_REVIEWS && webLen < SEO_MIN_WEB_OVERVIEW_LEN) {
    return { ok: false, reason: 'insufficient_reviews' };
  }

  return { ok: true };
}
