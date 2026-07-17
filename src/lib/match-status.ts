/**
 * Статусы уверенности матча для UI.
 * Проценты (matchConfidence) остаются только внутри алгоритма.
 */

import {
  AUTO_PICK_CONFIDENCE_THRESHOLD,
  MIN_COMPARE_MATCH_CONFIDENCE,
  isCloseMatchTie,
} from '@/lib/product-match';
import type { MarketplaceOffer, SearchCandidateOffer } from '@/types/comparison';

/** Публичные статусы — без процентов */
export type MatchStatus = 'verified' | 'probable' | 'needs_choice' | 'not_found';

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  verified: 'Проверено',
  probable: 'Лучшее предложение',
  needs_choice: 'Требуется выбор',
  not_found: 'Не найдено',
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
}): MatchStatus {
  if (input.isSource || input.isManual) return 'verified';

  if (input.needsManualPick) return 'needs_choice';

  if (!input.found) return 'not_found';

  const conf = input.matchConfidence ?? 0;
  const alts = input.alternativeCount ?? 0;

  if (conf >= 90 && alts === 0) return 'verified';
  if (conf >= AUTO_PICK_CONFIDENCE_THRESHOLD) {
    return alts > 0 ? 'probable' : conf >= 85 ? 'verified' : 'probable';
  }
  if (conf >= MIN_COMPARE_MATCH_CONFIDENCE) return 'probable';

  return 'not_found';
}

/** Приоритет для ранжированного пула (внутренний score, не для UI) */
export function computeCandidatePriority(params: {
  match: number;
  price?: number | null;
  referencePrice?: number;
  rating?: number | null;
  hasProductUrl?: boolean;
}): number {
  let priority = params.match;

  if (params.hasProductUrl) priority += 5;

  const rating = params.rating;
  if (rating != null && rating >= 4.7) priority += 4;
  else if (rating != null && rating >= 4.3) priority += 2;
  else if (rating != null && rating >= 4) priority += 1;

  const price = params.price;
  const ref = params.referencePrice;
  if (price && price > 0 && ref && ref > 0) {
    const ratio = price / ref;
    if (ratio >= 0.75 && ratio <= 1.25) priority += 4;
    else if (ratio >= 0.6 && ratio <= 1.4) priority += 2;
    if (price < ref) priority += 2;
  }

  return Math.max(0, Math.min(120, Math.round(priority)));
}

export interface RankedCandidate {
  candidate: SearchCandidateOffer;
  match: number;
  priority: number;
}

/** Сортировка пула: priority ↓, затем match ↓ */
export function sortCandidatePool(pool: RankedCandidate[]): RankedCandidate[] {
  return [...pool].sort((a, b) => b.priority - a.priority || b.match - a.match);
}

/**
 * Решить: автопривязка / выбор / не найдено.
 * Проценты не попадают в пользовательские сообщения.
 */
export function decideMatchOutcome(params: {
  bestMatch: number;
  secondMatch?: number;
  alternativeCount: number;
}): {
  autoPick: boolean;
  needsChoice: boolean;
  status: MatchStatus;
} {
  const { bestMatch, secondMatch, alternativeCount } = params;

  if (bestMatch < MIN_COMPARE_MATCH_CONFIDENCE) {
    return {
      autoPick: false,
      needsChoice: alternativeCount > 0,
      status: alternativeCount > 0 ? 'needs_choice' : 'not_found',
    };
  }

  if (bestMatch < AUTO_PICK_CONFIDENCE_THRESHOLD) {
    return { autoPick: false, needsChoice: true, status: 'needs_choice' };
  }

  if (secondMatch != null && isCloseMatchTie(bestMatch, secondMatch)) {
    return { autoPick: false, needsChoice: true, status: 'needs_choice' };
  }

  const status = resolveMatchStatus({
    found: true,
    matchConfidence: bestMatch,
    alternativeCount,
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
