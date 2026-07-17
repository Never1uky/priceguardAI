import type {
  AnalysisAlternative,
  FullAnalysisInput,
  FullProductAnalysis,
  RawFullAnalysisResponse,
} from '@/types/full-analysis';
import { FULL_ANALYSIS_SCHEMA_VERSION } from '@/types/full-analysis';
import type { FakeRiskLevel, PurchaseVerdict } from '@/types/review-analysis';
import { VERDICT_LABELS } from '@/types/review-analysis';
import { analyzeReviewsLocally } from '@/lib/ai/local-fallback';
import { buildPriceInsightOverlay } from '@/lib/price-insight-overlay';

function normalizeAlternatives(raw?: AnalysisAlternative[]): AnalysisAlternative[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a.name === 'string' && typeof a.reason === 'string')
    .slice(0, 3)
    .map((a) => ({ name: a.name.trim(), reason: a.reason.trim() }));
}

export function normalizeFullAnalysisResponse(raw: RawFullAnalysisResponse): FullProductAnalysis {
  const fakeRisk: FakeRiskLevel = ['low', 'medium', 'high'].includes(raw.fakeRisk)
    ? raw.fakeRisk
    : 'medium';

  const verdict: PurchaseVerdict = ['buy_now', 'wait_discount', 'not_recommended'].includes(
    raw.verdict,
  )
    ? raw.verdict
    : 'wait_discount';

  const pros = (raw.pros ?? raw.keySpecs ?? []).slice(0, 5);
  const cons = (raw.cons ?? raw.hiddenProblems ?? []).slice(0, 5);

  return {
    qualityScore: Math.min(10, Math.max(1, Number(raw.qualityScore) || 5)),
    qualitySummary: raw.qualitySummary || 'Недостаточно данных для оценки качества.',
    webOverview: raw.webOverview?.trim() || raw.qualitySummary || '',
    pros,
    cons,
    fakeRisk,
    fakeRiskExplanation: raw.fakeRiskExplanation || 'Оценка риска не предоставлена.',
    analogComparison: raw.analogComparison || 'Сравнение с аналогами недоступно.',
    alternatives: normalizeAlternatives(raw.alternatives),
    verdict,
    verdictExplanation: raw.verdictExplanation || VERDICT_LABELS[verdict],
    keySpecs: (raw.keySpecs ?? pros).slice(0, 5),
    hiddenProblems: (raw.hiddenProblems ?? cons).slice(0, 5),
    priceInsight: raw.priceInsight || 'Анализ цены ограничен.',
    source: 'local',
    providerLabel: 'Локальный анализ',
    analyzedAt: Date.now(),
    schemaVersion: FULL_ANALYSIS_SCHEMA_VERSION,
  };
}

/** Упрощённый полный анализ без облачного AI */
export function analyzeFullLocally(input: FullAnalysisInput): FullProductAnalysis {
  const reviewResult = analyzeReviewsLocally({
    reviews: input.reviews,
    productTitle: input.productTitle,
    productPrice: input.productPrice,
    marketplace: input.marketplace,
    totalReviewsFound: input.totalReviewsFound,
  });

  const qualityScore = Math.round(reviewResult.overallRating * 2);
  const priceInsight = buildPriceInsightOverlay(input);

  const alternatives: AnalysisAlternative[] = [];
  if (input.compareOffers?.length) {
    const validPrices = input.compareOffers.filter((o) => o.price && o.price > 0);
    if (validPrices.length) {
      for (const offer of validPrices.slice(0, 3)) {
        if (offer.title !== input.productTitle) {
          alternatives.push({
            name: offer.title.slice(0, 80),
            reason: `Цена ${offer.price} ₽ на ${offer.marketplace}`,
          });
        }
      }
    }
  }

  const analogComparison =
    input.compareOffers?.filter((o) => o.price).length
      ? 'На других площадках найдены альтернативные предложения — см. блок «Альтернативы».'
      : 'Добавьте товар в сравнение, чтобы увидеть цены на других маркетплейсах.';

  const hiddenProblems = reviewResult.cons.length
    ? reviewResult.cons
    : ['Явных скрытых проблем в отзывах не выявлено (локальный анализ).'];

  return normalizeFullAnalysisResponse({
    qualityScore,
    qualitySummary: reviewResult.summary,
    webOverview: `Локальный анализ «${input.productTitle.slice(0, 60)}» без облачного AI.`,
    pros: reviewResult.pros,
    cons: reviewResult.cons,
    fakeRisk: reviewResult.fakeRisk,
    fakeRiskExplanation: reviewResult.fakeRiskExplanation,
    analogComparison,
    alternatives,
    verdict: reviewResult.verdict,
    verdictExplanation: reviewResult.summary,
    keySpecs: reviewResult.pros.slice(0, 3).map((p) => `Плюс: ${p}`),
    hiddenProblems,
    priceInsight,
  });
}
