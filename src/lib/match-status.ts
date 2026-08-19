/**
 * Статусы уверенности матча для UI.
 * Проценты (matchConfidence) остаются только внутри алгоритма.
 */

import {
  AUTO_PICK_CONFIDENCE_THRESHOLD,
  CLOSE_MATCH_TIE_DELTA,
  MIN_COMPARE_MATCH_CONFIDENCE,
  isCloseMatchTie,
} from '@/lib/product-match';
import { resolveMatchFeatureFlags, type MatchFeatureFlags } from '@/lib/match-flags';
import type { MarketplaceOffer, SearchCandidateOffer } from '@/types/comparison';

/** Публичные статусы — без процентов */
export type MatchStatus =
  | 'verified'
  | 'probable'
  | 'needs_choice'
  | 'not_found'
  | 'loading_card'
  | 'serp_only'
  | 'oos'
  | 'blocked'
  | 'unverified_manual';

/** Среди близких матчей: разброс цен ≥5% → ручной выбор */
export const PRICE_SPREAD_FORCE_CHOICE_RATIO = 1.05;
export const CALIBRATED_MIN_COMPARE_MATCH_CONFIDENCE = 57;
export const CALIBRATED_AUTO_PICK_CONFIDENCE_THRESHOLD = 72;
export const CALIBRATED_VERIFIED_CONFIDENCE_NO_ALTS = 90;

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  verified: 'Проверено',
  probable: 'Лучшее предложение',
  needs_choice: 'Требуется выбор',
  not_found: 'Не найдено',
  loading_card: 'Загрузка карточки…',
  serp_only: 'Цена из поиска',
  oos: 'Нет в наличии',
  blocked: 'Площадка недоступна',
  unverified_manual: 'Вручную (непроверено)',
};

export function matchStatusShortHint(
  status: MatchStatus,
  alternativeCount = 0,
): string {
  switch (status) {
    case 'verified':
      return 'Проверено';
    case 'probable':
      return alternativeCount > 0
        ? `Лучшее предложение · ещё ${alternativeCount}`
        : 'Лучшее предложение';
    case 'needs_choice':
      return alternativeCount > 0
        ? `Есть ${alternativeCount} похожих — выберите`
        : 'Требуется выбор';
    case 'loading_card':
      return 'Загрузка карточки…';
    case 'serp_only':
      return 'Цена из поиска';
    case 'oos':
      return 'Нет в наличии';
    case 'blocked':
      return 'Площадка недоступна';
    case 'unverified_manual':
      return 'Вручную · без алертов';
    default:
      return 'Не найдено';
  }
}

export function resolveMatchStatus(input: {
  isSource?: boolean;
  isManual?: boolean;
  found?: boolean;
  needsManualPick?: boolean;
  matchConfidence?: number;
  alternativeCount?: number;
  featureFlags?: Partial<MatchFeatureFlags>;
}): MatchStatus {
  if (input.isSource || input.isManual) return 'verified';

  if (input.needsManualPick) return 'needs_choice';

  if (!input.found) return 'not_found';

  const conf = input.matchConfidence ?? 0;
  const alts = input.alternativeCount ?? 0;
  const flags = resolveMatchFeatureFlags(input.featureFlags);
  const minCompare = flags.enableCalibratedThresholds
    ? CALIBRATED_MIN_COMPARE_MATCH_CONFIDENCE
    : MIN_COMPARE_MATCH_CONFIDENCE;
  const autoPick = flags.enableCalibratedThresholds
    ? CALIBRATED_AUTO_PICK_CONFIDENCE_THRESHOLD
    : AUTO_PICK_CONFIDENCE_THRESHOLD;
  const verifiedNoAlts = flags.enableCalibratedThresholds
    ? CALIBRATED_VERIFIED_CONFIDENCE_NO_ALTS
    : 90;

  if (conf >= verifiedNoAlts && alts === 0) return 'verified';
  if (conf >= autoPick) {
    return alts > 0 ? 'probable' : conf >= 85 ? 'verified' : 'probable';
  }
  if (conf >= minCompare) return 'probable';

  return 'not_found';
}

/** Приоритет для ранжированного пула (внутренний score, не для UI) */
export function computeCandidatePriority(params: {
  match: number;
  price?: number | null;
  referencePrice?: number;
  rating?: number | null;
  hasProductUrl?: boolean;
  /** Boost from local pick history (0–5) */
  historyBoost?: number;
}): number {
  let priority = params.match;

  if (params.hasProductUrl) priority += 5;
  if (params.historyBoost) priority += Math.min(5, Math.max(0, params.historyBoost));

  const price = params.price;
  const ref = params.referencePrice;
  if (price && price > 0 && ref && ref > 0) {
    const ratio = price / ref;
    // Near reference (±25%) — strong boost; expensive outliers lose to SERP "from" prices
    if (ratio >= 0.7 && ratio <= 1.2) priority += 8;
    else if (ratio >= 0.55 && ratio <= 1.4) priority += 3;
    if (price <= ref) priority += 8;
    else if (price <= ref * 1.1) priority += 4;
    else if (price > ref * 1.35) priority -= 12;
    else if (price > ref * 1.2) priority -= 6;
  } else if (price && price > 0 && !ref) {
    // No reference — still prefer lower absolute prices among peers (tie-break later)
    priority += 1;
  }

  // Rating must not outweigh a large price gap (official 34k vs grey 24k)
  const rating = params.rating;
  if (rating != null && rating >= 4.7) priority += 2;
  else if (rating != null && rating >= 4.3) priority += 1;

  return Math.max(0, Math.min(120, Math.round(priority)));
}

export interface RankedCandidate {
  candidate: SearchCandidateOffer;
  match: number;
  priority: number;
}

/** Сортировка пула: priority ↓, затем match ↓, затем цена ↑ */
export function sortCandidatePool(pool: RankedCandidate[]): RankedCandidate[] {
  return [...pool].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.match !== a.match) return b.match - a.match;
    const pa = a.candidate.price ?? Number.POSITIVE_INFINITY;
    const pb = b.candidate.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

/** Среди кандидатов с confidence в пределах Δ от best — предпочесть минимальную цену */
export function pickCheapestAmongCloseMatches<T extends { confidence: number; price?: number | null }>(
  ranked: T[],
  delta = CLOSE_MATCH_TIE_DELTA,
): T[] {
  if (ranked.length < 2) return ranked;
  const best = ranked[0]!.confidence;
  const close = ranked.filter((r) => best - r.confidence <= delta);
  if (close.length < 2) return ranked;

  const priced = close.filter((r) => r.price != null && r.price > 0);
  if (priced.length < 2) return ranked;

  const cheapestFirst = [...priced].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const rest = ranked.filter((r) => !close.includes(r));
  const closeRest = close.filter((r) => r !== cheapestFirst[0]);
  return [cheapestFirst[0]!, ...closeRest, ...rest];
}

/** Spread ≥5% among close matches → force user pick */
export function hasLargePriceSpreadAmongClose(
  ranked: Array<{ confidence: number; price?: number | null }>,
  delta = CLOSE_MATCH_TIE_DELTA,
): boolean {
  if (ranked.length < 2) return false;
  const best = ranked[0]!.confidence;
  const prices = ranked
    .filter((r) => best - r.confidence <= delta)
    .map((r) => r.price)
    .filter((p): p is number => p != null && p > 0);
  if (prices.length < 2) return false;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return max / min >= PRICE_SPREAD_FORCE_CHOICE_RATIO;
}

/**
 * Решить: автопривязка / выбор / не найдено.
 * Проценты не попадают в пользовательские сообщения.
 */
export function decideMatchOutcome(params: {
  bestMatch: number;
  secondMatch?: number;
  alternativeCount: number;
  featureFlags?: Partial<MatchFeatureFlags>;
}): {
  autoPick: boolean;
  needsChoice: boolean;
  status: MatchStatus;
} {
  const { bestMatch, secondMatch, alternativeCount } = params;
  const flags = resolveMatchFeatureFlags(params.featureFlags);
  const minCompare = flags.enableCalibratedThresholds
    ? CALIBRATED_MIN_COMPARE_MATCH_CONFIDENCE
    : MIN_COMPARE_MATCH_CONFIDENCE;
  const autoPick = flags.enableCalibratedThresholds
    ? CALIBRATED_AUTO_PICK_CONFIDENCE_THRESHOLD
    : AUTO_PICK_CONFIDENCE_THRESHOLD;

  if (bestMatch < minCompare) {
    return {
      autoPick: false,
      needsChoice: alternativeCount > 0,
      status: alternativeCount > 0 ? 'needs_choice' : 'not_found',
    };
  }

  if (bestMatch < autoPick) {
    return { autoPick: false, needsChoice: true, status: 'needs_choice' };
  }

  if (secondMatch != null && isCloseMatchTie(bestMatch, secondMatch)) {
    return { autoPick: false, needsChoice: true, status: 'needs_choice' };
  }

  const status = resolveMatchStatus({
    found: true,
    matchConfidence: bestMatch,
    alternativeCount,
    featureFlags: params.featureFlags,
  });

  return { autoPick: true, needsChoice: false, status };
}

/** Достать статус с оффера или вычислить */
export function offerMatchStatus(
  offer: MarketplaceOffer,
  options?: { isSource?: boolean; isManual?: boolean },
): MatchStatus {
  if (offer.matchStatus) return offer.matchStatus;

  const alts = offer.searchCandidates?.length ?? 0;
  const alternativeCount =
    offer.needsManualPick ? alts : Math.max(0, alts - (isOfferBestInCandidates(offer) ? 1 : 0));

  return resolveMatchStatus({
    isSource: options?.isSource,
    isManual: options?.isManual,
    found: offer.found && Boolean(offer.price && offer.price > 0),
    needsManualPick: offer.needsManualPick,
    matchConfidence: offer.matchConfidence,
    alternativeCount: offer.needsManualPick ? alts : alternativeCount,
  });
}

function isOfferBestInCandidates(offer: MarketplaceOffer): boolean {
  if (!offer.url || !offer.searchCandidates?.length) return false;
  return offer.searchCandidates.some((c) => c.url === offer.url);
}
