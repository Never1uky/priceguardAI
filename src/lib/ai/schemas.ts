import type { AnalysisAlternative, RawFullAnalysisResponse } from '@/types/full-analysis';
import type { FakeRiskLevel, PurchaseVerdict, RawAiReviewResponse } from '@/types/review-analysis';

/** Параметры всех AI-запросов анализа */
export const AI_REQUEST_DEFAULTS = {
  jsonMode: true,
  temperature: 0.2,
} as const;

/** schema_version=3: structured only; optional reviewThemes/audience*; priceInsight короткий */
export const FULL_ANALYSIS_JSON_SCHEMA = {
  qualityScore: 'number 1–10',
  qualitySummary: 'string ≤2 предложения',
  webOverview: 'string 2–4 предложения (≥80 символов, если отзывов мало / нет веб-блока; синтез из отзывов+title, без выдуманных обзоров из сети)',
  pros: 'string[] (≤4, коротко, конкретика из отзывов)',
  cons: 'string[] (≤4, коротко, конкретика из отзывов)',
  fakeRisk: '"low" | "medium" | "high"',
  fakeRiskExplanation: 'string ≤1 предложение',
  analogComparison: 'string ≤2 предложения',
  alternatives: '{ name: string, reason: string }[] (0–3, только реальные модели)',
  verdict: '"buy_now" | "wait_discount" | "not_recommended"',
  verdictExplanation: 'string ≤2 предложения',
  keySpecs: 'string[] (≤5)',
  hiddenProblems: 'string[] (≤4)',
  priceInsight: 'string ≤1 предложение (цена/скидка; без прогноза)',
  reviewThemes:
    '{ praise: string[], complain: string[], rare: string[] } (опционально, ≤4 каждый)',
  audienceFit: 'string[] (опционально, ≤4 — кому подойдёт)',
  audienceAvoid: 'string[] (опционально, ≤4 — кому не подойдёт)',
  dataGaps: 'string[] (опционально — чего не хватило в данных)',
} as const;

export const REVIEW_ANALYSIS_JSON_SCHEMA = {
  overallRating: 'number 1–5 (один знак после запятой)',
  pros: 'string[] (до 5)',
  cons: 'string[] (до 5)',
  fakeRisk: '"low" | "medium" | "high"',
  fakeRiskExplanation: 'string',
  verdict: '"buy_now" | "wait_discount" | "not_recommended"',
  summary: 'string',
} as const;

function asStringArray(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

function asAlternatives(value: unknown): AnalysisAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is AnalysisAlternative =>
        Boolean(v) &&
        typeof v === 'object' &&
        typeof (v as AnalysisAlternative).name === 'string' &&
        typeof (v as AnalysisAlternative).reason === 'string',
    )
    .slice(0, 3);
}

function asFakeRisk(value: unknown): FakeRiskLevel | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function asVerdict(value: unknown): PurchaseVerdict | null {
  return value === 'buy_now' || value === 'wait_discount' || value === 'not_recommended'
    ? value
    : null;
}

function asReviewThemes(value: unknown): RawFullAnalysisResponse['reviewThemes'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const praise = asStringArray(o.praise, 4);
  const complain = asStringArray(o.complain, 4);
  const rare = asStringArray(o.rare, 4);
  if (!praise.length && !complain.length && !rare.length) return undefined;
  return { praise, complain, rare };
}

function asFocusNotes(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
      out[k.trim()] = v.trim().slice(0, 200);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Валидация и нормализация JSON полного анализа */
export function validateFullAnalysisJson(raw: unknown): RawFullAnalysisResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI вернул не объект JSON');
  }

  const obj = raw as Record<string, unknown>;
  const fakeRisk = asFakeRisk(obj.fakeRisk);
  const verdict = asVerdict(obj.verdict);
  const qualityScore = Number(obj.qualityScore);

  if (!Number.isFinite(qualityScore) || qualityScore < 1 || qualityScore > 10) {
    throw new Error('Некорректное поле qualityScore');
  }
  if (!fakeRisk) throw new Error('Некорректное поле fakeRisk');
  if (!verdict) throw new Error('Некорректное поле verdict');
  if (typeof obj.qualitySummary !== 'string' || !obj.qualitySummary.trim()) {
    throw new Error('Отсутствует qualitySummary');
  }
  if (typeof obj.verdictExplanation !== 'string' || !obj.verdictExplanation.trim()) {
    throw new Error('Отсутствует verdictExplanation');
  }

  return {
    qualityScore,
    qualitySummary: obj.qualitySummary.trim(),
    webOverview: typeof obj.webOverview === 'string' ? obj.webOverview.trim() : undefined,
    pros: asStringArray(obj.pros),
    cons: asStringArray(obj.cons),
    fakeRisk,
    fakeRiskExplanation:
      typeof obj.fakeRiskExplanation === 'string' ? obj.fakeRiskExplanation.trim() : '',
    analogComparison:
      typeof obj.analogComparison === 'string' ? obj.analogComparison.trim() : '',
    alternatives: asAlternatives(obj.alternatives),
    verdict,
    verdictExplanation: obj.verdictExplanation.trim(),
    keySpecs: asStringArray(obj.keySpecs, 8),
    hiddenProblems: asStringArray(obj.hiddenProblems, 8),
    priceInsight: typeof obj.priceInsight === 'string' ? obj.priceInsight.trim() : '',
    reviewThemes: asReviewThemes(obj.reviewThemes),
    audienceFit: asStringArray(obj.audienceFit, 4),
    audienceAvoid: asStringArray(obj.audienceAvoid, 4),
    dataGaps: asStringArray(obj.dataGaps, 4),
    focusNotes: asFocusNotes(obj.focusNotes),
  };
}

/** Валидация JSON анализа отзывов */
export function validateReviewAnalysisJson(raw: unknown): RawAiReviewResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI вернул не объект JSON');
  }

  const obj = raw as Record<string, unknown>;
  const fakeRisk = asFakeRisk(obj.fakeRisk);
  const verdict = asVerdict(obj.verdict);
  const overallRating = Number(obj.overallRating);

  if (!Number.isFinite(overallRating) || overallRating < 1 || overallRating > 5) {
    throw new Error('Некорректное поле overallRating');
  }
  if (!fakeRisk) throw new Error('Некорректное поле fakeRisk');
  if (!verdict) throw new Error('Некорректное поле verdict');
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) {
    throw new Error('Отсутствует summary');
  }

  return {
    overallRating,
    pros: asStringArray(obj.pros),
    cons: asStringArray(obj.cons),
    fakeRisk,
    fakeRiskExplanation:
      typeof obj.fakeRiskExplanation === 'string' ? obj.fakeRiskExplanation.trim() : '',
    verdict,
    summary: obj.summary.trim(),
  };
}

export function schemaToPromptBlock(
  schema: Record<string, string>,
): string {
  const lines = Object.entries(schema).map(([key, type]) => `  "${key}": ${type}`);
  return `{\n${lines.join(',\n')}\n}`;
}
