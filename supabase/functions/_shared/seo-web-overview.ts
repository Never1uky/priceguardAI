/**
 * Mirror of src/lib/seo/web-overview-enrich.ts for Edge seo-publish.
 * Compose webOverview from existing analysis — no invented reviews.
 */

import { SEO_MIN_WEB_OVERVIEW_LEN } from './seo-gates.ts';
import { focusAxesForCategorySlug } from './seo-category-focus.ts';

function asTrimmedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

export type WebOverviewEnrichInput = {
  webOverview?: string | null;
  qualitySummary?: string | null;
  verdictExplanation?: string | null;
  priceInsight?: string | null;
  pros?: unknown;
  cons?: unknown;
  keySpecs?: unknown;
  focusNotes?: string | null;
};

export function composeWebOverviewFromAnalysis(
  analysis: WebOverviewEnrichInput,
  opts?: { categorySlug?: string | null; minLen?: number },
): string {
  const minLen = opts?.minLen ?? SEO_MIN_WEB_OVERVIEW_LEN;
  const existing = (analysis.webOverview ?? '').trim();
  if (existing.length >= minLen) return existing;

  const parts: string[] = [];
  const pushUnique = (s: string | null | undefined) => {
    const t = (s ?? '').trim();
    if (!t) return;
    if (parts.some((p) => p.includes(t) || t.includes(p))) return;
    parts.push(t);
  };

  pushUnique(existing);
  pushUnique(analysis.qualitySummary);
  pushUnique(analysis.verdictExplanation);

  const pros = asTrimmedList(analysis.pros).slice(0, 3);
  if (pros.length) pushUnique(`Плюсы по данным анализа: ${pros.join('; ')}.`);

  const cons = asTrimmedList(analysis.cons).slice(0, 2);
  if (cons.length) pushUnique(`На что обратить внимание: ${cons.join('; ')}.`);

  const specs = asTrimmedList(analysis.keySpecs).slice(0, 3);
  if (specs.length) pushUnique(`Ключевые моменты: ${specs.join('; ')}.`);

  pushUnique(analysis.priceInsight);
  pushUnique(analysis.focusNotes);

  let text = parts.join(' ').replace(/\s+/g, ' ').trim();

  // Known category only — never DEFAULT_AXES fluff (would pad thin analyses past gate).
  if (text.length < minLen) {
    const slug = (opts?.categorySlug ?? '').trim().toLowerCase();
    const axes = slug ? focusAxesForCategorySlug(slug) : [];
    const isGenericDefault =
      axes.length > 0 && axes[0] === 'качество' && axes.includes('удобство');
    if (slug && axes.length && !isGenericDefault) {
      const hint = `При сравнении ориентируйтесь на: ${axes.slice(0, 4).join(', ')}.`;
      if (!text.includes(hint)) text = `${text} ${hint}`.trim();
    }
  }

  return text.slice(0, 1200);
}

export function enrichAnalysisWebOverviewForSeo<T extends WebOverviewEnrichInput>(
  analysis: T,
  opts?: { categorySlug?: string | null; minLen?: number },
): T & { webOverview: string } {
  const webOverview = composeWebOverviewFromAnalysis(analysis, opts);
  return { ...analysis, webOverview };
}
