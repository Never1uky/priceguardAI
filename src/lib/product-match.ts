import { productTokenOverlapScore, titleSimilarity } from '@/lib/compare-merge';
import { levenshteinSimilarity, matchConfidencePercent } from '@/lib/fuzzy-match';
import {
  areCategoriesIncompatible,
  getCategoryMismatchPenalty,
  inferProductCategory,
  shouldIgnoreSizeMismatch,
  shouldPenalizeStorageMismatch,
  isSoftFeature,
  SOFT_MODEL_MATCH_CATEGORIES,
  type ProductCategory,
} from '@/lib/match-category';
import { areEntityRolesIncompatible } from '@/lib/entity-extract';
import { areBrandsCompatible, extractProductModel, variantMismatchPenalty } from '@/lib/model-extract';
import {
  areLineageGenerationsCompatible,
  extractLineageGeneration,
} from '@/lib/lineage-generation';
import { extractProductFeatures, scoreFeatureMatch } from '@/lib/product-features';
import { isWildberriesFeedbacksUrl } from '@/utils/product-url';
import { normalizeCompareUrl } from '@/utils/comparison-url';

/** Минимальная уверенность совпадения (0–100) для удержания оффера в сравнении */
export const MIN_COMPARE_MATCH_CONFIDENCE = 55;

/** Автовыбор без подтверждения пользователя (SERP title score) */
export const AUTO_PICK_CONFIDENCE_THRESHOLD = 70;

/**
 * UI warning (не auto-pick): низкая уверенность или category soft mismatch.
 * Не меняет MIN_COMPARE / AUTO_PICK.
 */
export const WARN_MATCH_CONFIDENCE = 65;

/** Cap when one side is generic and the other is a specific category (0–1). */
export const GENERIC_VS_SPECIFIC_SCORE_CAP = 0.35;

/**
 * После открытия карточки: автопривязка только при score ≥ этого порога.
 * Ниже — needs_choice / следующий кандидат.
 */
export const CARD_VERIFY_CONFIDENCE_THRESHOLD = 90;

/**
 * Ровно 1 кандидат (SERP или после cascade) с score ≥ этого порога —
 * автопривязка без UI «выберите товар», даже если карточка не открылась
 * (тогда берём SERP price/rating).
 */
export const SINGLE_CANDIDATE_AUTO_PICK_THRESHOLD = 95;

/** Ниже этого порога — показываем топ-3 кандидатов */
export const MANUAL_PICK_CONFIDENCE_THRESHOLD = AUTO_PICK_CONFIDENCE_THRESHOLD;

/** Разница confidence (0–100), при которой два кандидата считаются «ничьей» → ручной выбор / cheaper wins */
export const CLOSE_MATCH_TIE_DELTA = 5;

export const DEFAULT_MIN_MATCH_SCORE = 0.55;
export const DEFAULT_MAX_PRICE_RATIO = 1.3;
/** Stricter for electronics when prices are both known (blocks stencil/accessory outliers). */
export const ELECTRONICS_MAX_PRICE_RATIO = 1.35;

/**
 * UI warning kinds (не auto-pick). Не меняет MIN_COMPARE / AUTO_PICK.
 * - category: hard incompatible OR generic↔specific with weak signal
 * - confidence: low confidence AND low title similarity (not near-identical titles)
 */
export type MatchWarnKind = 'category' | 'confidence';

/** Soft title-similarity floor for confidence-only warn (0–1). */
export const WARN_LOW_TITLE_SIMILARITY = 0.55;

function isAuthenticityHardConflict(refValue: string, candValue: string): boolean {
  const ref = refValue.toLowerCase();
  const cand = candValue.toLowerCase();
  const originalLike = new Set(['original', 'oem']);
  const copyLike = new Set(['replica', 'analog', 'compatible']);
  if (originalLike.has(ref) && copyLike.has(cand)) return true;
  if (copyLike.has(ref) && originalLike.has(cand)) return true;
  return false;
}

function isRegionHardConflict(refValue: string, candValue: string): boolean {
  const ref = refValue.toLowerCase();
  const cand = candValue.toLowerCase();
  if (ref === cand) return false;
  const simSet = new Set(['esim_only', 'sim_physical']);
  if (simSet.has(ref) || simSet.has(cand)) return true;
  return true;
}

function isEditionHardConflict(refValue: string, candValue: string): boolean {
  const ref = refValue.toLowerCase();
  const cand = candValue.toLowerCase();
  const pairs = new Set(['disc|digital', 'digital|disc', 'kit|body', 'body|kit']);
  return pairs.has(`${ref}|${cand}`);
}

function hasCompatibilityMarker(title: string): boolean {
  if (/совместим[а-яёa-z]*/i.test(title)) return true;
  return /(?:для|for)\s+(?:[a-z][a-z0-9\-]*|[а-яёa-z0-9\-]*\d[а-яёa-z0-9\-]*)/i.test(title);
}

export function getMatchWarnKind(
  referenceTitle: string,
  candidateTitle: string,
  matchConfidence?: number | null,
  referenceSpecs?: string,
): MatchWarnKind | null {
  if (!referenceTitle || !candidateTitle || candidateTitle === 'Товар') return null;

  const refCat = inferProductCategory(referenceTitle, referenceSpecs);
  const candCat = inferProductCategory(candidateTitle);

  if (areCategoriesIncompatible(refCat, candCat)) return 'category';
  if (areEntityRolesIncompatible(referenceTitle, candidateTitle, referenceSpecs)) {
    return 'category';
  }

  const genericVsSpecific =
    (refCat === 'generic' && candCat !== 'generic') ||
    (candCat === 'generic' && refCat !== 'generic');
  if (genericVsSpecific) {
    const weakConf =
      matchConfidence != null && matchConfidence < WARN_MATCH_CONFIDENCE;
    const weakScore =
      scoreProductMatch(referenceTitle, candidateTitle, referenceSpecs) <=
      GENERIC_VS_SPECIFIC_SCORE_CAP;
    if (weakConf || weakScore) return 'category';
  }

  if (!areLineageGenerationsCompatible(referenceTitle, candidateTitle)) {
    return 'confidence';
  }

  // Same / compatible categories: confidence-only warn only if titles are weakly similar
  if (matchConfidence != null && matchConfidence < WARN_MATCH_CONFIDENCE) {
    const sim = Math.max(
      titleSimilarity(referenceTitle, candidateTitle),
      productTokenOverlapScore(referenceTitle, candidateTitle),
    );
    const matchScore = scoreProductMatch(referenceTitle, candidateTitle, referenceSpecs);
    // Near-identical / same-line products (e.g. Haier TV variants) — no soft warn
    if (sim >= WARN_LOW_TITLE_SIMILARITY || matchScore >= DEFAULT_MIN_MATCH_SCORE) {
      return null;
    }
    return 'confidence';
  }

  return null;
}

/** Dismissible UI: category / weak-title confidence (not identical TV↔TV). */
export function shouldWarnWeakMatch(
  referenceTitle: string,
  candidateTitle: string,
  matchConfidence?: number | null,
  referenceSpecs?: string,
): boolean {
  return getMatchWarnKind(referenceTitle, candidateTitle, matchConfidence, referenceSpecs) != null;
}

const STRICT_PRICE_CATEGORIES: ProductCategory[] = [
  'laptops',
  'gpus',
  'desktops',
  'smartphones',
  'consoles',
];

export function maxPriceRatioForCategory(category?: ProductCategory): number {
  if (category && STRICT_PRICE_CATEGORIES.includes(category)) {
    return ELECTRONICS_MAX_PRICE_RATIO;
  }
  return DEFAULT_MAX_PRICE_RATIO;
}

function pickScoreBoostForUrl(
  url: string | undefined,
  scoreBoostByUrl?: ReadonlyMap<string, number>,
): number {
  if (!url || !scoreBoostByUrl?.size) return 0;
  const direct = scoreBoostByUrl.get(url.toLowerCase());
  if (direct != null) return direct;
  try {
    const normalized = normalizeCompareUrl(url).toLowerCase();
    return scoreBoostByUrl.get(normalized) ?? 0;
  } catch {
    return 0;
  }
}

function pickScoreBoost<T>(
  candidate: T,
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined },
): number {
  return pickScoreBoostForUrl(options.getUrl?.(candidate), options.scoreBoostByUrl);
}

function applyPickScoreBoost<T>(
  baseScore: number,
  candidate: T,
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined },
): number {
  return Math.min(1, baseScore + pickScoreBoost(candidate, options));
}

/** Ручная ссылка: ниже порога или чужой бренд — спросить подтверждение */
export const MANUAL_LINK_CONFIRM_CONFIDENCE = AUTO_PICK_CONFIDENCE_THRESHOLD;

/** Кандидат достаточно похож на эталон (бренд + min confidence) */
export function isAcceptableProductMatch(
  referenceTitle: string,
  candidateTitle: string,
  minConfidence = MIN_COMPARE_MATCH_CONFIDENCE,
  referenceSpecs?: string,
): boolean {
  if (!referenceTitle || !candidateTitle || referenceTitle === 'Товар') return false;
  if (!areBrandsCompatible(referenceTitle, candidateTitle)) return false;
  return computeMatchConfidence(referenceTitle, candidateTitle, referenceSpecs) >= minConfidence;
}

/** Два высоких скора почти равны — не автопривязываем (вместо дорогого AI-тай-брейка) */
export function isCloseMatchTie(bestConfidence: number, secondConfidence: number): boolean {
  if (bestConfidence < AUTO_PICK_CONFIDENCE_THRESHOLD) return false;
  if (secondConfidence < MIN_COMPARE_MATCH_CONFIDENCE) return false;
  return bestConfidence - secondConfidence <= CLOSE_MATCH_TIE_DELTA;
}

export interface PickMatchOptions {
  referencePrice?: number;
  minScore?: number;
  maxPriceRatio?: number;
  getPrice?: (item: unknown) => number | null | undefined;
  /** URL карточек, которые пользователь отклонил («не тот товар») */
  excludedUrls?: string[];
  /** Характеристики эталона для памяти/цвета */
  referenceSpecs?: string;
  /** Override inferred category for scoring */
  category?: ProductCategory;
  /**
   * Additive score boost by normalized candidate URL (0–0.05 from local pick-history).
   * Does not bypass brand/price filters — tie-break only.
   */
  scoreBoostByUrl?: ReadonlyMap<string, number>;
}

/**
 * When best confidence is ambiguous, UI may request AI tie-break (phase 2 stub).
 * Does not call LLM — only signals.
 */
export function needsAiTiebreak(
  bestConfidence: number,
  secondConfidence?: number,
): boolean {
  if (secondConfidence != null && isCloseMatchTie(bestConfidence, secondConfidence)) {
    return true;
  }
  return bestConfidence >= 75 && bestConfidence < 90;
}

function normalizeUrlForExclude(url: string): string {
  try {
    return normalizeCompareUrl(url);
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

export function isUrlExcluded(url: string | undefined, excludedUrls?: string[]): boolean {
  if (!url || !excludedUrls?.length) return false;
  const norm = normalizeUrlForExclude(url);
  return excludedUrls.some((e) => {
    const ex = normalizeUrlForExclude(e);
    return norm === ex || norm.includes(ex) || ex.includes(norm);
  });
}

/** Процент сходства заголовков для UI (0–100) */
export function computeMatchConfidence(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
  category?: ProductCategory,
): number {
  return matchConfidencePercent(
    scoreProductMatch(referenceTitle, candidateTitle, referenceSpecs, category),
  );
}

function normalizeModelKey(model: string): string {
  return model.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
}

/** Подвариант линейки AirPods для строгого сравнения */
function airpodsSubvariant(key: string): string | null {
  if (!key.includes('airpods')) return null;
  if (key.includes('max')) return 'max';
  if (key.includes('pro')) return 'pro';
  if (key.includes('anc')) return 'anc';
  const gen = key.match(/airpods(\d)/);
  if (gen) return `gen${gen[1]}`;
  if (key === 'airpods' || key === 'appleairpods') return 'generic';
  return 'other';
}

/** Совместимы ли две извлечённые модели (не путать Max / Pro / ANC) */
export function areModelsCompatible(refModel: string, candModel: string): boolean {
  const refKey = normalizeModelKey(refModel);
  const candKey = normalizeModelKey(candModel);

  if (!refKey || !candKey) return true;
  if (refKey === candKey) return true;

  const refAir = airpodsSubvariant(refKey);
  const candAir = airpodsSubvariant(candKey);
  if (refAir !== null && candAir !== null) {
    return refAir === candAir;
  }

  // MacBook Air ≠ MacBook Pro
  if (refKey.includes('macbook') && candKey.includes('macbook')) {
    const refType = refKey.includes('pro') ? 'pro' : refKey.includes('air') ? 'air' : 'base';
    const candType = candKey.includes('pro') ? 'pro' : candKey.includes('air') ? 'air' : 'base';
    return refType === candType;
  }

  // Kingston Canvas Go Plus ≠ Canvas Select Plus
  if (/\bcanvas\b/.test(refKey) && /\bcanvas\b/.test(candKey)) {
    const line = (k: string) => {
      if (/canvasgo/.test(k)) return 'go_plus';
      if (/canvasselect/.test(k)) return 'select_plus';
      if (/canvasreact/.test(k)) return 'react';
      if (/canvasendurance/.test(k)) return 'endurance';
      return 'other';
    };
    return line(refKey) === line(candKey);
  }

  // iPad Pro ≠ iPad Air
  if (refKey.includes('ipad') && candKey.includes('ipad')) {
    const tier = (k: string) =>
      k.includes('pro') ? 'pro' : k.includes('air') ? 'air' : k.includes('mini') ? 'mini' : 'base';
    return tier(refKey) === tier(candKey);
  }

  // Частичное вхождение только при почти одинаковой длине
  if (refKey.includes(candKey) || candKey.includes(refKey)) {
    const ratio = Math.min(refKey.length, candKey.length) / Math.max(refKey.length, candKey.length);
    return ratio >= 0.85;
  }

  return false;
}

export function arePricesCompatible(
  referencePrice: number,
  candidatePrice: number,
  maxRatio = DEFAULT_MAX_PRICE_RATIO,
): boolean {
  if (!referencePrice || !candidatePrice || referencePrice <= 0 || candidatePrice <= 0) {
    return true;
  }
  const ratio = Math.max(referencePrice, candidatePrice) / Math.min(referencePrice, candidatePrice);
  return ratio <= maxRatio;
}

/** Оценка совпадения кандидата с эталонным товаром (0–1) */
export function scoreProductMatch(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
  category?: ProductCategory,
): number {
  if (!referenceTitle || !candidateTitle || referenceTitle === 'Товар' || candidateTitle === 'Товар') {
    return 0;
  }

  // Category hard reject before brand soft-reject
  const earlyCategory =
    category ?? inferProductCategory(referenceTitle, referenceSpecs);
  const candidateCategory = inferProductCategory(candidateTitle);
  if (areCategoriesIncompatible(earlyCategory, candidateCategory)) {
    return 0;
  }
  // Role-relation hard block (accessory/consumable ↔ host primary, same family)
  if (areEntityRolesIncompatible(referenceTitle, candidateTitle, referenceSpecs)) {
    return 0;
  }
  if (
    hasCompatibilityMarker(referenceTitle) !== hasCompatibilityMarker(candidateTitle) &&
    earlyCategory !== 'accessories' &&
    candidateCategory !== 'accessories'
  ) {
    return 0;
  }

  const genericVsSpecific =
    (earlyCategory === 'generic' && candidateCategory !== 'generic') ||
    (candidateCategory === 'generic' && earlyCategory !== 'generic');

  // Same product line, different generation digit (Buds 5 ≠ Buds 6)
  if (!areLineageGenerationsCompatible(referenceTitle, candidateTitle)) {
    return 0;
  }

  // Разные бренды (Redmi ≠ Realme, ASUS ≠ Xiaomi) — жёсткий штраф
  if (!areBrandsCompatible(referenceTitle, candidateTitle)) {
    return 0;
  }

  const refModel = extractProductModel(referenceTitle);
  const candModel = extractProductModel(candidateTitle);
  const softModelMatch = SOFT_MODEL_MATCH_CATEGORIES.includes(earlyCategory);

  if (
    !softModelMatch &&
    refModel.model &&
    candModel.model &&
    !areModelsCompatible(refModel.model, candModel.model)
  ) {
    // Same lineage+generation (Buds 5 vs Buds 5) — skip hard model-string reject
    const refLin = extractLineageGeneration(referenceTitle);
    const candLin = extractLineageGeneration(candidateTitle);
    const sameLineageGen =
      Boolean(refLin && candLin) &&
      refLin!.gen === candLin!.gen &&
      (refLin!.lineage === candLin!.lineage ||
        (refLin!.lineage.startsWith('buds:') && candLin!.lineage.startsWith('buds:')));
    if (!sameLineageGen) {
      return 0;
    }
  }

  // Feature matching — category profile weights
  const refFeatures = extractProductFeatures(referenceTitle, referenceSpecs);
  const candFeatures = extractProductFeatures(candidateTitle);
  if (category) {
    refFeatures.category = category;
    candFeatures.category = category;
  }
  const resolvedCategory = refFeatures.category ?? candFeatures.category;

  // Hard identity gate: storage mismatch for categories where storage defines SKU.
  if (
    resolvedCategory &&
    shouldPenalizeStorageMismatch(resolvedCategory) &&
    refFeatures.storage &&
    candFeatures.storage &&
    refFeatures.storage !== candFeatures.storage
  ) {
    return 0;
  }

  // Hard identity gate: connector mismatch where connector defines SKU.
  if (
    (resolvedCategory === 'headphones' || resolvedCategory === 'accessories') &&
    refFeatures.connector &&
    candFeatures.connector &&
    refFeatures.connector !== candFeatures.connector
  ) {
    return 0;
  }

  // Hard identity gate: condition mismatch when both sides are explicit.
  if (refFeatures.condition && candFeatures.condition && refFeatures.condition !== candFeatures.condition) {
    return 0;
  }

  // Hard identity gate: authenticity original/oem vs replica/analog/compatible.
  if (
    refFeatures.authenticity &&
    candFeatures.authenticity &&
    isAuthenticityHardConflict(refFeatures.authenticity, candFeatures.authenticity)
  ) {
    return 0;
  }

  // Hard identity gate: explicit region/sim mode mismatch.
  if (refFeatures.region && candFeatures.region && isRegionHardConflict(refFeatures.region, candFeatures.region)) {
    return 0;
  }

  // Hard identity gate: explicit edition conflicts (disc vs digital, kit vs body).
  if (
    refFeatures.edition &&
    candFeatures.edition &&
    isEditionHardConflict(refFeatures.edition, candFeatures.edition)
  ) {
    return 0;
  }

  // Hard identity gate: quantity mismatch for detergents / food-like categories.
  if (
    (resolvedCategory === 'detergents' || resolvedCategory === 'pet_food') &&
    refFeatures.packageCount != null &&
    candFeatures.packageCount != null &&
    refFeatures.packageCount !== candFeatures.packageCount
  ) {
    return 0;
  }

  const { score: featureScore } = scoreFeatureMatch(refFeatures, candFeatures, true);
  let score = featureScore / 100;

  // Мягкий текстовый fallback, если features слабо извлеклись
  const titleScore = Math.max(
    titleSimilarity(referenceTitle, candidateTitle),
    productTokenOverlapScore(referenceTitle, candidateTitle),
    levenshteinSimilarity(referenceTitle, candidateTitle),
  );
  if (!refFeatures.model || !candFeatures.model) {
    score = Math.max(score, titleScore * 0.85);
  } else {
    score = Math.max(score, Math.min(titleScore, 0.72));
  }

  if (refModel.model && candModel.model) {
    const refNorm = normalizeModelKey(refModel.model);
    const candNorm = normalizeModelKey(candModel.model);

    if (refNorm === candNorm) {
      score = Math.max(score, 0.95);
    } else if (areModelsCompatible(refModel.model, candModel.model)) {
      score = Math.max(score, 0.75);
    } else if (refModel.searchQuery && candModel.searchQuery) {
      const queryOverlap = titleSimilarity(refModel.searchQuery, candModel.searchQuery);
      score = Math.max(score, queryOverlap * 0.85);
    }
  }

  // Apparel/shoes: size is soft — don't apply storage-style variant penalty for size.
  // Storage penalty only for categories that care about memory.
  // Smartphones: color is soft — do not apply color variantPenalty (model/lineage dominate).
  let variantPenalty = variantMismatchPenalty(referenceTitle, candidateTitle, referenceSpecs);
  if (resolvedCategory && isSoftFeature(resolvedCategory, 'color')) {
    const ref = extractProductFeatures(referenceTitle, referenceSpecs);
    const cand = extractProductFeatures(candidateTitle);
    if (ref.color && cand.color && ref.color !== cand.color) {
      // Remove color portion (~0.3) that variantMismatchPenalty added
      variantPenalty = Math.max(0, variantPenalty - 0.3);
    }
  }
  if (resolvedCategory && !shouldPenalizeStorageMismatch(resolvedCategory)) {
    // Recalculate: only color (and never size) for non-electronics
    const ref = extractProductFeatures(referenceTitle, referenceSpecs);
    const cand = extractProductFeatures(candidateTitle);
    variantPenalty = 0;
    if (
      ref.color &&
      cand.color &&
      ref.color !== cand.color &&
      !isSoftFeature(resolvedCategory, 'color')
    ) {
      variantPenalty += 0.2;
    }
    if (
      shouldIgnoreSizeMismatch(resolvedCategory) &&
      ref.size &&
      cand.size &&
      ref.size !== cand.size
    ) {
      // explicit no-op — size soft
      variantPenalty += 0;
    }
  }
  if (variantPenalty > 0) {
    score = Math.max(0, score - variantPenalty);
  }

  if (resolvedCategory) {
    const categoryPenalty = getCategoryMismatchPenalty(
      resolvedCategory,
      referenceTitle,
      candidateTitle,
    );
    if (categoryPenalty > 0) {
      score = Math.max(0, score - categoryPenalty);
    }
  }

  // generic ↔ specific: never high-confidence auto-pick
  if (genericVsSpecific) {
    score = Math.min(score, GENERIC_VS_SPECIFIC_SCORE_CAP);
  }

  // Connector unknown on one side: allow compare, but no auto-pick for connector-sensitive categories.
  if (
    (resolvedCategory === 'headphones' || resolvedCategory === 'accessories') &&
    ((refFeatures.connector && !candFeatures.connector) || (!refFeatures.connector && candFeatures.connector))
  ) {
    score = Math.min(score, 0.69);
  }

  return score;
}

/** Explain which factor dominates a low/zero match — for telemetry. */
export function diagnoseMatchFactors(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
  category?: ProductCategory,
): {
  score: number;
  confidence: number;
  titleSimilarity: number;
  brandMatch: boolean;
  modelMatch: boolean | null;
  categoryCompatible: boolean;
  rejectField: string | null;
  selectionReason: string;
} {
  const score = scoreProductMatch(referenceTitle, candidateTitle, referenceSpecs, category);
  const confidence = matchConfidencePercent(score);
  const earlyCategory = category ?? inferProductCategory(referenceTitle, referenceSpecs);
  const candidateCategory = inferProductCategory(candidateTitle);
  const categoryCompatible = !areCategoriesIncompatible(earlyCategory, candidateCategory);
  const brandMatch = areBrandsCompatible(referenceTitle, candidateTitle);
  const refModel = extractProductModel(referenceTitle);
  const candModel = extractProductModel(candidateTitle);
  const softModelMatch = SOFT_MODEL_MATCH_CATEGORIES.includes(earlyCategory);
  let modelMatch: boolean | null = null;
  if (refModel.model && candModel.model) {
    modelMatch = areModelsCompatible(refModel.model, candModel.model);
  }
  const titleSim = titleSimilarity(referenceTitle, candidateTitle);

  let rejectField: string | null = null;
  let selectionReason = 'scored';
  if (!referenceTitle || !candidateTitle || referenceTitle === 'Товар' || candidateTitle === 'Товар') {
    rejectField = 'empty_title';
    selectionReason = 'empty_title';
  } else if (!categoryCompatible) {
    rejectField = 'category';
    selectionReason = 'category_incompatible';
  } else if (areEntityRolesIncompatible(referenceTitle, candidateTitle, referenceSpecs)) {
    rejectField = 'entity_role';
    selectionReason = 'entity_role_incompatible';
  } else if (!areLineageGenerationsCompatible(referenceTitle, candidateTitle) && score <= 0.15) {
    rejectField = 'lineage_generation';
    selectionReason = 'lineage_mismatch';
  } else if (!brandMatch) {
    rejectField = 'brand';
    selectionReason = 'brand_mismatch';
  } else if (modelMatch === false && !softModelMatch && score <= 0.15) {
    rejectField = 'model';
    selectionReason = 'model_mismatch';
  } else if (confidence < MIN_COMPARE_MATCH_CONFIDENCE) {
    rejectField = 'confidence';
    selectionReason = 'below_min_confidence';
  } else if (confidence < AUTO_PICK_CONFIDENCE_THRESHOLD) {
    selectionReason = 'needs_choice_or_probable';
  } else {
    selectionReason = 'auto_pick_eligible';
  }

  return {
    score,
    confidence,
    titleSimilarity: titleSim,
    brandMatch,
    modelMatch,
    categoryCompatible,
    rejectField: confidence >= MIN_COMPARE_MATCH_CONFIDENCE ? null : rejectField,
    selectionReason,
  };
}

export function pickBestMatch<T>(
  referenceTitle: string,
  candidates: T[],
  getTitle: (item: T) => string,
  options: PickMatchOptions = {},
): T | null {
  const match = pickBestMatchWithScore(referenceTitle, candidates, getTitle, options);
  return match?.item ?? null;
}

/** Лучший кандидат + числовой score (для confidence match) */
export function pickBestMatchWithScore<T>(
  referenceTitle: string,
  candidates: T[],
  getTitle: (item: T) => string,
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined } = {},
): { item: T; score: number } | null {
  if (!candidates.length) return null;

  const minScore = options.minScore ?? DEFAULT_MIN_MATCH_SCORE;
  const category = options.category ?? inferProductCategory(referenceTitle, options.referenceSpecs);
  const maxRatio = options.maxPriceRatio ?? maxPriceRatioForCategory(category);
  const refPrice = options.referencePrice;
  const excluded = options.excludedUrls ?? [];

  let best: T | null = null;
  let bestScore = minScore;

  for (const candidate of candidates) {
    if (options.getUrl && isUrlExcluded(options.getUrl(candidate), excluded)) {
      continue;
    }

    if (refPrice && options.getPrice) {
      const candPrice = options.getPrice(candidate);
      if (candPrice && !arePricesCompatible(refPrice, candPrice, maxRatio)) {
        continue;
      }
    }

    const score = applyPickScoreBoost(
      scoreProductMatch(referenceTitle, getTitle(candidate), options.referenceSpecs, category),
      candidate,
      options,
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best ? { item: best, score: bestScore } : null;
}

/** Топ-N кандидатов по score (для ручного выбора) */
export function pickTopMatchesWithScore<T>(
  referenceTitle: string,
  candidates: T[],
  getTitle: (item: T) => string,
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined; limit?: number } = {},
): Array<{ item: T; score: number }> {
  if (!candidates.length) return [];

  const maxRatio =
    options.maxPriceRatio ??
    maxPriceRatioForCategory(
      options.category ?? inferProductCategory(referenceTitle, options.referenceSpecs),
    );
  const refPrice = options.referencePrice;
  const excluded = options.excludedUrls ?? [];
  const limit = options.limit ?? 3;
  const minScore = (options.minScore ?? DEFAULT_MIN_MATCH_SCORE) * 0.85;
  const category = options.category ?? inferProductCategory(referenceTitle, options.referenceSpecs);

  const scored: Array<{ item: T; score: number }> = [];

  for (const candidate of candidates) {
    if (options.getUrl && isUrlExcluded(options.getUrl(candidate), excluded)) {
      continue;
    }

    if (refPrice && options.getPrice) {
      const candPrice = options.getPrice(candidate);
      if (candPrice && !arePricesCompatible(refPrice, candPrice, maxRatio * 1.4)) {
        continue;
      }
    }

    const score = applyPickScoreBoost(
      scoreProductMatch(referenceTitle, getTitle(candidate), options.referenceSpecs, category),
      candidate,
      options,
    );
    if (score >= minScore) {
      scored.push({ item: candidate, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Строгий матч, а при его отсутствии — лучший кандидат из выдачи в пределах
 * разумного диапазона цены. Используется в поиске по маркетплейсам, чтобы
 * не терять валидные результаты, когда строгий порог чуть-чуть не достигнут.
 */
export function pickBestMatchWithFallback<T>(
  referenceTitle: string,
  candidates: T[],
  getTitle: (item: T) => string,
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined } = {},
): T | null {
  const strict = pickBestMatchWithScore(referenceTitle, candidates, getTitle, options);
  if (strict) return strict.item;

  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : '';
  if (!ref) return null;

  const refPrice = options.referencePrice;
  const maxRatio = options.maxPriceRatio ?? DEFAULT_MAX_PRICE_RATIO;
  const excluded = options.excludedUrls ?? [];

  let fallback: T | null = null;
  let fallbackScore = 0.5;

  for (const candidate of candidates) {
    if (options.getUrl && isUrlExcluded(options.getUrl(candidate), excluded)) {
      continue;
    }

    if (refPrice && options.getPrice) {
      const candPrice = options.getPrice(candidate);
      if (candPrice && !arePricesCompatible(refPrice, candPrice, maxRatio * 1.3)) {
        continue;
      }
    }

    const score = applyPickScoreBoost(
      scoreProductMatch(ref, getTitle(candidate), options.referenceSpecs),
      candidate,
      options,
    );
    if (score > fallbackScore) {
      fallbackScore = score;
      fallback = candidate;
    }
  }

  return fallback;
}

/** Strict match + confidence score */
export function pickBestMatchWithFallbackScored<T>(
  referenceTitle: string,
  candidates: T[],
  getTitle: (item: T) => string,
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined } = {},
): { item: T; score: number } | null {
  const strict = pickBestMatchWithScore(referenceTitle, candidates, getTitle, options);
  if (strict) return strict;

  const item = pickBestMatchWithFallback(referenceTitle, candidates, getTitle, options);
  if (!item) return null;

  return {
    item,
    score: applyPickScoreBoost(
      scoreProductMatch(referenceTitle, getTitle(item), options.referenceSpecs),
      item,
      options,
    ),
  };
}

export function isProductPageUrl(url: string): boolean {
  if (isWildberriesFeedbacksUrl(url)) return false;
  if (/search\.aspx|\/catalog\/0\/|\/search\?/i.test(url)) return false;

  const catalogMatch = url.match(/\/catalog\/(\d+)/i);
  if (catalogMatch && catalogMatch[1] !== '0') return true;

  return /\/product\//i.test(url) || /\/card\//i.test(url) || /\/product--/i.test(url)
    || /\/t\/[a-zA-Z0-9]+/i.test(url) || /\/cc\/[a-zA-Z0-9]+/i.test(url);
}

export function isSearchPageUrl(url: string): boolean {
  return /search|text=|search\.aspx/i.test(url);
}
