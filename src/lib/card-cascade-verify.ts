/**
 * Variant 2: SERP is only a source of product-card URLs.
 * Top-N candidates → open each card → re-score → auto-pick / needs_choice / not_found.
 */
import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { isOfferWithPrice, normalizeMarketplaceRating } from '@/lib/compare-offers';
import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import { isOutOfStockError } from '@/lib/out-of-stock';
import {
  hasLargePriceSpreadAmongClose,
  pickCheapestAmongCloseMatches,
  resolveMatchStatus,
} from '@/lib/match-status';
import {
  CARD_VERIFY_CONFIDENCE_THRESHOLD,
  computeMatchConfidence,
  isProductPageUrl,
  MIN_COMPARE_MATCH_CONFIDENCE,
  SINGLE_CANDIDATE_AUTO_PICK_THRESHOLD,
} from '@/lib/product-match';
import { hashQuery, telemetry } from '@/lib/telemetry';
import { isTitleCategoryCompatible, inferProductCategory } from '@/lib/match-category';
import { normalizeCompareUrl } from '@/utils/comparison-url';
import { resolveCandidateDisplayTitle, sanitizeCandidateTitle } from '@/lib/serp-title';

/** Prefer SERP "from" when card opens a dearer default offer (YM/WB/Ozon). */
export function pickSerpOrCardPrice(
  serpPrice?: number | null,
  cardPrice?: number | null,
): number | null {
  const prices = [serpPrice, cardPrice].filter((p): p is number => p != null && p > 0);
  if (!prices.length) return null;
  return Math.min(...prices);
}

export interface SerpCascadeCandidate {
  url: string;
  title: string;
  price: number | null;
  imageUrl?: string;
  rating?: number | null;
  serpConfidence: number;
}

function notFoundOffer(
  marketplace: ComparisonMarketplace,
  query: string,
  searchUrl: string,
  error?: string,
): MarketplaceOffer {
  return {
    marketplace,
    title: query,
    price: null,
    delivery: null,
    rating: null,
    url: searchUrl,
    found: false,
    error: error ?? 'Товар не найден',
    matchStatus: 'not_found',
  };
}

function normalizeCandidateUrl(url: string): string {
  try {
    return normalizeCompareUrl(url);
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function pickRating(
  ...values: Array<number | null | undefined>
): number | null {
  for (const v of values) {
    const n = normalizeMarketplaceRating(v);
    if (n != null) return n;
  }
  return null;
}

/** Collect product-card URLs from a SERP-derived offer (never search URLs). */
export function collectSerpCascadeCandidates(offer: MarketplaceOffer): SerpCascadeCandidate[] {
  const out: SerpCascadeCandidate[] = [];
  const seen = new Set<string>();

  const push = (c: SerpCascadeCandidate) => {
    if (!c.url || !isProductPageUrl(c.url)) return;
    const key = normalizeCandidateUrl(c.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...c, url: key });
  };

  if (offer.found && offer.url && isProductPageUrl(offer.url)) {
    push({
      url: offer.url,
      title: sanitizeCandidateTitle(offer.title, undefined, offer.url),
      price: offer.price,
      imageUrl: offer.imageUrl,
      rating: offer.rating,
      serpConfidence: offer.matchConfidence ?? 0,
    });
  }

  for (const c of offer.searchCandidates ?? []) {
    push({
      url: c.url,
      title: sanitizeCandidateTitle(c.title, undefined, c.url),
      price: c.price,
      imageUrl: c.imageUrl,
      rating: c.rating,
      serpConfidence: c.matchConfidence ?? 0,
    });
  }

  return out.slice(0, MAX_CANDIDATE_POOL);
}

function toSearchCandidate(
  offer: MarketplaceOffer,
  confidence: number,
  index: number,
): SearchCandidateOffer {
  return {
    title: resolveCandidateDisplayTitle({
      serpTitle: offer.title,
      cardTitle: offer.title,
      url: offer.url,
    }),
    url: offer.url,
    price: offer.price,
    matchConfidence: confidence,
    priority: 100 - index,
    imageUrl: offer.imageUrl,
    rating: normalizeMarketplaceRating(offer.rating),
  };
}

function verifiedAutoPick(
  offer: MarketplaceOffer,
  confidence: number,
  alternatives: SearchCandidateOffer[] = [],
): MarketplaceOffer {
  return {
    ...offer,
    rating: normalizeMarketplaceRating(offer.rating),
    matchConfidence: confidence,
    matchStatus: resolveMatchStatus({
      found: true,
      matchConfidence: confidence,
      alternativeCount: alternatives.length,
    }),
    searchCandidates: alternatives.length ? alternatives : undefined,
    needsManualPick: false,
    found: true,
    error: undefined,
  };
}

/**
 * Ровно 1 кандидат, score ≥ 95, product URL + цена → verified без UI выбора.
 */
function trySingleCandidateAutoPick(
  marketplace: ComparisonMarketplace,
  candidate: {
    title: string;
    url: string;
    price: number | null;
    imageUrl?: string;
    rating?: number | null;
    confidence: number;
  },
  serpRating?: number | null,
): MarketplaceOffer | null {
  if (candidate.confidence < SINGLE_CANDIDATE_AUTO_PICK_THRESHOLD) return null;
  if (!candidate.url || !isProductPageUrl(candidate.url)) return null;
  if (candidate.price == null || candidate.price <= 0) return null;

  return verifiedAutoPick(
    {
      marketplace,
      title: candidate.title,
      price: candidate.price,
      delivery: null,
      rating: pickRating(candidate.rating, serpRating),
      url: normalizeCandidateUrl(candidate.url),
      imageUrl: candidate.imageUrl,
      found: true,
    },
    candidate.confidence,
  );
}

function needsChoiceShell(
  marketplace: ComparisonMarketplace,
  searchCandidates: SearchCandidateOffer[],
  searchUrl: string,
  error: string,
): MarketplaceOffer {
  const best = searchCandidates[0]!;
  // Always use search URL — a candidate product URL looks like a "bound" card to refresh
  // and background price checks would wipe the picker into not_found.
  const shellRating =
    searchCandidates.length === 1 ? normalizeMarketplaceRating(best.rating) : null;

  return {
    marketplace,
    title: best.title,
    price: null,
    delivery: null,
    rating: shellRating,
    reviewCount: undefined,
    url: searchUrl,
    found: false,
    matchConfidence: best.matchConfidence,
    matchStatus: 'needs_choice',
    searchCandidates,
    needsManualPick: true,
    error,
  };
}

/**
 * Open top SERP candidates as product cards, re-score, then decide.
 * Never treats a search-page URL as a successful match.
 */
export async function verifySerpOfferWithCardCascade(
  serpOffer: MarketplaceOffer,
  options: {
    referenceTitle: string;
    referenceSpecs?: string;
    query: string;
    searchUrl: string;
  },
): Promise<MarketplaceOffer> {
  const { referenceTitle, referenceSpecs, query, searchUrl } = options;
  const marketplace = serpOffer.marketplace;
  const candidates = collectSerpCascadeCandidates(serpOffer);
  const serpRating = normalizeMarketplaceRating(serpOffer.rating);
  const qHash = hashQuery(query);

  telemetry.info({
    stage: 'cascade',
    name: 'CARD_FETCH_STARTED',
    marketplace,
    queryHash: qHash,
    data: { candidateCount: candidates.length },
  });

  if (!candidates.length) {
    telemetry.warn({
      stage: 'cascade',
      name: 'CARD_FETCH_FAILED',
      marketplace,
      queryHash: qHash,
      success: false,
      errorCode: 'no_candidates',
    });
    return notFoundOffer(
      marketplace,
      query,
      searchUrl,
      serpOffer.error ?? 'Подходящий товар не найден в выдаче',
    );
  }

  const verified: Array<{ offer: MarketplaceOffer; confidence: number; price: number | null }> =
    [];
  const cardFetched: Array<{
    candidate: SerpCascadeCandidate;
    card: MarketplaceOffer | null;
  }> = [];

  for (const candidate of candidates) {
    let card: MarketplaceOffer | null = null;
    const cardStarted = Date.now();
    try {
      card = await fetchOfferFromUrl(candidate.url, marketplace, { forceTab: true });
    } catch (error) {
      telemetry.warn({
        stage: 'card',
        name: 'CARD_FETCH_FAILED',
        marketplace,
        queryHash: qHash,
        success: false,
        elapsedMs: Date.now() - cardStarted,
        errorCode: 'card_exception',
        error,
        data: { url: candidate.url },
      });
      console.warn('[PriceGuard] card cascade fetch:', candidate.url, error);
      cardFetched.push({ candidate, card: null });
      continue;
    }

    cardFetched.push({ candidate, card });

    if (!card) {
      telemetry.warn({
        stage: 'card',
        name: 'CARD_FETCH_FAILED',
        marketplace,
        queryHash: qHash,
        success: false,
        elapsedMs: Date.now() - cardStarted,
        errorCode: 'card_null',
        data: { url: candidate.url },
      });
      continue;
    }
    if (isOutOfStockError(card.error)) continue;
    if (!isOfferWithPrice(card) || !card.url || !isProductPageUrl(card.url)) continue;

    const titleForScore = card.title?.trim() || candidate.title;
    const confidence = computeMatchConfidence(
      referenceTitle,
      titleForScore,
      referenceSpecs,
    );

    telemetry.info({
      stage: 'card',
      name: 'CARD_FETCH_SUCCESS',
      marketplace,
      queryHash: qHash,
      success: true,
      elapsedMs: Date.now() - cardStarted,
      data: { confidence, priced: true },
    });

    if (confidence < MIN_COMPARE_MATCH_CONFIDENCE) continue;
    if (!isTitleCategoryCompatible(referenceTitle, titleForScore, referenceSpecs)) continue;

    const displayPrice = pickSerpOrCardPrice(candidate.price, card.price);

    verified.push({
      offer: {
        ...card,
        url: normalizeCandidateUrl(card.url),
        title: titleForScore,
        price: displayPrice,
        found: true,
        matchConfidence: confidence,
        imageUrl: card.imageUrl ?? candidate.imageUrl,
        rating: pickRating(card.rating, candidate.rating, serpRating),
      },
      confidence,
      price: displayPrice,
    });
  }

  const buildChoiceCandidate = (
    row: { candidate: SerpCascadeCandidate; card: MarketplaceOffer | null },
    index: number,
  ): SearchCandidateOffer => ({
    title: resolveCandidateDisplayTitle({
      serpTitle: row.candidate.title,
      cardTitle: row.card?.title,
      url: row.candidate.url,
    }),
    url: row.candidate.url,
    // SERP often shows "from" price; card opens default (dearer) offer — keep cheaper for picker
    price: pickSerpOrCardPrice(row.candidate.price, row.card?.price),
    matchConfidence: row.candidate.serpConfidence,
    priority: 100 - index,
    imageUrl: row.card?.imageUrl ?? row.candidate.imageUrl,
    rating: normalizeMarketplaceRating(row.card?.rating ?? row.candidate.rating),
  });

  if (!verified.length) {
    // Cards failed — single high-confidence SERP hit with price → auto-pick
    // BUT never auto-pick when the only card opened and was OOS (would re-bind dead URL)
    if (candidates.length === 1) {
      const only = candidates[0]!;
      const onlyRow = cardFetched.find(
        (r) => normalizeCandidateUrl(r.candidate.url) === normalizeCandidateUrl(only.url),
      );
      const cardWasOos =
        onlyRow?.card != null &&
        (isOutOfStockError(onlyRow.card.error) || onlyRow.card.matchStatus === 'oos');
      if (
        !cardWasOos &&
        isTitleCategoryCompatible(referenceTitle, only.title, referenceSpecs) &&
        only.serpConfidence >= MIN_COMPARE_MATCH_CONFIDENCE
      ) {
        const auto = trySingleCandidateAutoPick(
          marketplace,
          {
            title: only.title,
            url: only.url,
            price: only.price,
            imageUrl: only.imageUrl,
            rating: only.rating,
            confidence: only.serpConfidence,
          },
          serpRating,
        );
        if (auto) return auto;
      }
    }

    // Promo SERP titles: keep card display title even when categories are weak/generic
    // Exclude OOS cards so picker / next research does not re-bind dead URLs
    const choiceRows = (cardFetched.length
      ? cardFetched
      : candidates.map((c) => ({ candidate: c, card: null as MarketplaceOffer | null }))
    ).filter((row) => {
      if (
        row.card &&
        (isOutOfStockError(row.card.error) || row.card.matchStatus === 'oos')
      ) {
        return false;
      }
      if (!row.candidate.url || !isProductPageUrl(row.candidate.url)) return false;
      const title = resolveCandidateDisplayTitle({
        serpTitle: row.candidate.title,
        cardTitle: row.card?.title,
        url: row.candidate.url,
      });
      // Always keep rows that already opened a card (display title from card)
      if (row.card) {
        return isTitleCategoryCompatible(referenceTitle, title, referenceSpecs) ||
          inferProductCategory(referenceTitle, referenceSpecs) === 'generic' ||
          inferProductCategory(title) === 'generic';
      }
      if (!isTitleCategoryCompatible(referenceTitle, title, referenceSpecs)) return false;
      // Mixed models of the same category (Pixel 7 vs 9a) must stay in the picker
      // even when SERP confidence is below MIN_COMPARE — not_found hides the tiles.
      if (candidates.length >= 2) return true;
      return row.candidate.serpConfidence >= MIN_COMPARE_MATCH_CONFIDENCE;
    });

    if (!choiceRows.length) {
      const anyOos = cardFetched.some(
        (r) => r.card && (isOutOfStockError(r.card.error) || r.card.matchStatus === 'oos'),
      );
      return notFoundOffer(
        marketplace,
        query,
        searchUrl,
        anyOos
          ? 'Нет в наличии на подходящих карточках — попробуйте «Найти заново»'
          : 'Подходящий товар той же категории не найден',
      );
    }

    const searchCandidates: SearchCandidateOffer[] = choiceRows.map((row, i) =>
      buildChoiceCandidate(row, i),
    );
    return needsChoiceShell(
      marketplace,
      searchCandidates,
      searchUrl,
      searchCandidates.length > 1
        ? `Выберите товар (${searchCandidates.length})`
        : 'Выберите товар или укажите ссылку',
    );
  }

  const reordered = pickCheapestAmongCloseMatches(verified);
  const forceChoice = hasLargePriceSpreadAmongClose(reordered);

  const aboveCardThreshold = reordered.filter(
    (r) => r.confidence >= CARD_VERIFY_CONFIDENCE_THRESHOLD,
  );

  // Variant B: open all Top-3, auto-pick best among cards that clear the card threshold
  if (aboveCardThreshold.length > 0 && !forceChoice) {
    const best = aboveCardThreshold[0]!;
    const alternatives = aboveCardThreshold
      .slice(1)
      .map((r, i) => toSearchCandidate(r.offer, r.confidence, i + 1));
    return verifiedAutoPick(
      {
        ...best.offer,
        rating: pickRating(best.offer.rating, serpRating, candidates.find((c) =>
          normalizeCandidateUrl(c.url) === normalizeCandidateUrl(best.offer.url),
        )?.rating),
      },
      best.confidence,
      alternatives,
    );
  }

  // Removed dead branch: single card ≥ SINGLE (95) with !forceChoice always hits
  // aboveCardThreshold (≥ CARD_VERIFY 90) first. Single ≥95 after forceChoice /
  // pool path is handled by trySingleCandidateAutoPick below.

  const pool = (aboveCardThreshold.length > 0 ? aboveCardThreshold : reordered).slice(
    0,
    MAX_CANDIDATE_POOL,
  );
  const searchCandidates = pool.map((r, i) => toSearchCandidate(r.offer, r.confidence, i));

  // Single pool item ≥ 95 → auto (covers edge cases where forceChoice was false but threshold branch missed)
  if (searchCandidates.length === 1) {
    const only = pool[0]!;
    const auto = trySingleCandidateAutoPick(
      marketplace,
      {
        title: only.offer.title,
        url: only.offer.url,
        price: only.offer.price,
        imageUrl: only.offer.imageUrl,
        rating: only.offer.rating,
        confidence: only.confidence,
      },
      serpRating,
    );
    if (auto) return auto;
  }

  return needsChoiceShell(
    marketplace,
    searchCandidates,
    searchUrl,
    searchCandidates.length > 1
      ? forceChoice
        ? `Цены сильно отличаются — выберите нужный из ${searchCandidates.length}`
        : `Есть ${searchCandidates.length} похожих варианта — выберите нужный`
      : 'Требуется выбор товара',
  );
}
