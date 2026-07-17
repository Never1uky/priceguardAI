import { productTokenOverlapScore, titleSimilarity } from '@/lib/compare-merge';
import { levenshteinSimilarity, matchConfidencePercent } from '@/lib/fuzzy-match';
import { areBrandsCompatible, extractProductModel, variantMismatchPenalty } from '@/lib/model-extract';
import { extractProductFeatures, scoreFeatureMatch } from '@/lib/product-features';
import { isWildberriesFeedbacksUrl } from '@/utils/product-url';
import { normalizeCompareUrl } from '@/utils/comparison-url';

/** Минимальная уверенность совпадения (0–100) для автопривязки в сравнении */
export const MIN_COMPARE_MATCH_CONFIDENCE = 45;

/** Автовыбор без подтверждения пользователя */
export const AUTO_PICK_CONFIDENCE_THRESHOLD = 70;

/** Ниже этого порога — показываем топ-3 кандидатов */
export const MANUAL_PICK_CONFIDENCE_THRESHOLD = AUTO_PICK_CONFIDENCE_THRESHOLD;

/** Разница confidence (0–100), при которой два кандидата считаются «ничьей» → ручной выбор */
export const CLOSE_MATCH_TIE_DELTA = 3;

export const DEFAULT_MIN_MATCH_SCORE = 0.48;
export const DEFAULT_MAX_PRICE_RATIO = 1.3;

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
): number {
  return matchConfidencePercent(scoreProductMatch(referenceTitle, candidateTitle, referenceSpecs));
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
): number {
  if (!referenceTitle || !candidateTitle || referenceTitle === 'Товар' || candidateTitle === 'Товар') {
    return 0;
  }

  // Разные бренды (Redmi ≠ Realme, ASUS ≠ Xiaomi) — жёсткий штраф
  if (!areBrandsCompatible(referenceTitle, candidateTitle)) {
    return 0.05;
  }

  const refModel = extractProductModel(referenceTitle);
  const candModel = extractProductModel(candidateTitle);

  if (refModel.model && candModel.model && !areModelsCompatible(refModel.model, candModel.model)) {
    return Math.min(
      titleSimilarity(referenceTitle, candidateTitle),
      productTokenOverlapScore(referenceTitle, candidateTitle),
      0.15,
    );
  }

  // Feature matching (brand/model/storage/color) — основной сигнал
  const refFeatures = extractProductFeatures(referenceTitle, referenceSpecs);
  const candFeatures = extractProductFeatures(candidateTitle);
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

  const variantPenalty = variantMismatchPenalty(referenceTitle, candidateTitle, referenceSpecs);
  if (variantPenalty > 0) {
    score = Math.max(0, score - variantPenalty);
  }

  return score;
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
  const maxRatio = options.maxPriceRatio ?? DEFAULT_MAX_PRICE_RATIO;
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

    const score = scoreProductMatch(referenceTitle, getTitle(candidate), options.referenceSpecs);
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

  const maxRatio = options.maxPriceRatio ?? DEFAULT_MAX_PRICE_RATIO;
  const refPrice = options.referencePrice;
  const excluded = options.excludedUrls ?? [];
  const limit = options.limit ?? 3;
  const minScore = (options.minScore ?? DEFAULT_MIN_MATCH_SCORE) * 0.85;

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

    const score = scoreProductMatch(referenceTitle, getTitle(candidate), options.referenceSpecs);
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

    const score = scoreProductMatch(ref, getTitle(candidate), options.referenceSpecs);
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
    score: scoreProductMatch(referenceTitle, getTitle(item), options.referenceSpecs),
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
