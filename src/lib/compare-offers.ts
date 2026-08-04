import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { isProductPageUrl, isSearchPageUrl } from '@/lib/product-match';
import { offerLinkUrl } from '@/utils/product-url';
import { syncPoolOntoProduct } from '@/lib/candidate-pool';
import { preferRealTitle } from '@/utils/wb-image';
import { isOutOfStockError, OUT_OF_STOCK_ERROR } from '@/lib/out-of-stock';

const DEFAULT_NOT_FOUND_ERROR =
  'Товар не найден — добавьте прямую ссылку на карточку';

/** Drop dead product-card URL so refresh/research do not re-bind the same OOS/404 page. */
function clearBoundProductPageUrl(url: string | undefined): string {
  if (!url) return '';
  if (isProductPageUrl(url)) return '';
  return url;
}
function preferOfferTitle(
  incoming: string | null | undefined,
  base: string | null | undefined,
): string {
  return preferRealTitle(incoming, base, 'Товар');
}

export function isOfferWithPrice(offer: MarketplaceOffer | null | undefined): boolean {
  return Boolean(offer && offer.price != null && offer.price > 0);
}

/**
 * Рейтинг площадки 1–5.
 * Принимает number / «4,5» / «4.5 из 5»; мусор вроде 14.2 → null.
 */
export function normalizeMarketplaceRating(
  rating: number | string | null | undefined,
): number | null {
  if (rating == null) return null;

  let n: number;
  if (typeof rating === 'string') {
    const trimmed = rating.trim().replace(/\u00a0/g, ' ');
    if (!trimmed) return null;
    const match =
      trimmed.match(/(\d+[.,]\d+|\d)\s*(?:из\s*5|\/\s*5)/i) ??
      trimmed.match(/^(\d+[.,]\d+|\d)$/);
    if (!match?.[1]) return null;
    n = parseFloat(match[1].replace(',', '.'));
  } else {
    n = rating;
  }

  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return Math.round(n * 10) / 10;
}

/** Достать рейтинг/число отзывов из текста плитки или карточки. */
export function parseRatingFromMarketplaceText(text: string): {
  rating: number | null;
  reviewCount?: number;
} {
  const normalized = text.replace(/\u00a0/g, ' ');
  const ratingMatch =
    normalized.match(/(\d+[.,]\d+)\s*(?:из\s*5|★|⭐)/i) ??
    normalized.match(/рейтинг[:\s]*(\d+[.,]\d+)/i) ??
    normalized.match(/(\d+[.,]\d+)\s*(?:из|★|⭐)/);

  const rating = normalizeMarketplaceRating(ratingMatch?.[1] ?? null);

  const reviewMatch =
    normalized.match(/(\d[\d\s]*)\s*отзыв/i) ??
    normalized.match(/(\d[\d\s]*)\s*оцен/i);

  const reviewCount = reviewMatch
    ? Number.parseInt(reviewMatch[1].replace(/\s/g, ''), 10)
    : undefined;

  return {
    rating,
    reviewCount: reviewCount && reviewCount > 0 ? reviewCount : undefined,
  };
}

export function isUsefulOffer(offer: MarketplaceOffer | null | undefined): boolean {
  if (!offer) return false;
  if (offer.needsManualPick && offer.searchCandidates?.length) return true;
  return isOfferWithPrice(offer) || hasRating(offer) || Boolean(offer.specs);
}

/** Pending UI picker: needsManualPick + nonempty searchCandidates. */
export function isPendingManualChoice(offer: MarketplaceOffer | null | undefined): boolean {
  return Boolean(offer?.needsManualPick && (offer.searchCandidates?.length ?? 0) > 0);
}

/**
 * Pick the richer of two offers for the same marketplace.
 *
 * Rules (explicit):
 * 1. Pending needs_choice (with candidates) always beats empty not_found/loading/oos/blocked.
 * 2. Priced direct card beats pending choice (user/auto resolved).
 * 3. Between two pending choices: more searchCandidates wins; if equal length, preferA wins
 *    (caller passes preferA=true when existing.comparedAt >= incoming.comparedAt).
 */
export function preferRicherMarketplaceOffer(
  a: MarketplaceOffer,
  b: MarketplaceOffer,
  options?: { preferAIfEqualAmbiguous?: boolean },
): MarketplaceOffer {
  const aPending = isPendingManualChoice(a);
  const bPending = isPendingManualChoice(b);
  const aPriced =
    isOfferWithPrice(a) && Boolean(a.url) && !isSearchPageUrl(a.url) && !a.needsManualPick;
  const bPriced =
    isOfferWithPrice(b) && Boolean(b.url) && !isSearchPageUrl(b.url) && !b.needsManualPick;

  if (aPriced && !bPriced) return a;
  if (bPriced && !aPriced) return b;
  if (aPriced && bPriced) return mergeMarketplaceOffers(a, b);

  if (aPending && !bPending) return finalizeResearchOffer(a);
  if (bPending && !aPending) return finalizeResearchOffer(b);

  if (aPending && bPending) {
    const aN = a.searchCandidates!.length;
    const bN = b.searchCandidates!.length;
    if (aN !== bN) return aN > bN ? finalizeResearchOffer(a) : finalizeResearchOffer(b);
    const preferA = options?.preferAIfEqualAmbiguous !== false;
    return finalizeResearchOffer(preferA ? a : b);
  }

  return mergeMarketplaceOffers(a, b);
}

export function hasRating(offer: MarketplaceOffer | null | undefined): boolean {
  return Boolean(normalizeMarketplaceRating(offer?.rating) != null);
}

export function ensureOfferWithPrice(offer: MarketplaceOffer): MarketplaceOffer {
  if (isOfferWithPrice(offer)) {
    return { ...offer, found: true };
  }
  return { ...offer, found: false };
}

/**
 * После research/search: слот без цены → явный not_found/oos/needs_choice.
 * Не оставляем «пустой» оффер (UI иначе показывает вечное «Нет цены» / «Поиск…»).
 */
export function finalizeResearchOffer(offer: MarketplaceOffer): MarketplaceOffer {
  const candidates = offer.searchCandidates?.length ?? 0;
  if ((offer.needsManualPick || offer.matchStatus === 'needs_choice') && candidates > 0) {
    return {
      ...offer,
      price: null,
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
    };
  }

  if (isOfferWithPrice(offer) && !offer.needsManualPick) {
    return offer;
  }

  if (isOutOfStockError(offer.error) || offer.matchStatus === 'oos') {
    return {
      ...offer,
      url: clearBoundProductPageUrl(offer.url),
      price: null,
      found: false,
      matchStatus: 'oos',
      error: offer.error?.trim() || OUT_OF_STOCK_ERROR,
      needsManualPick: false,
    };
  }

  // loading_card without price is only valid mid-flight; callers must finalize at end
  return {
    ...offer,
    url: clearBoundProductPageUrl(offer.url),
    price: null,
    found: false,
    needsManualPick: false,
    matchStatus: 'not_found',
    error: offer.error?.trim() || DEFAULT_NOT_FOUND_ERROR,
  };
}

/** Persist-safe: leftover loading_card → not_found (after job done / crash). */
export function settleStaleLoadingOffer(offer: MarketplaceOffer): MarketplaceOffer {
  if (offer.matchStatus !== 'loading_card') return offer;
  if (isPendingManualChoice(offer)) {
    return {
      ...offer,
      price: null,
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
    };
  }
  if (isOfferWithPrice(offer)) {
    return { ...offer, matchStatus: offer.matchStatus === 'loading_card' ? 'serp_only' : offer.matchStatus };
  }
  return finalizeResearchOffer({ ...offer, matchStatus: undefined });
}

export function settleStaleLoadingOffers(offers: MarketplaceOffer[]): MarketplaceOffer[] {
  return offers.map(settleStaleLoadingOffer);
}

function clearsStalePrice(incoming: MarketplaceOffer): boolean {
  if (incoming.needsManualPick) return true;
  if (incoming.matchStatus === 'not_found') return true;
  if (incoming.matchStatus === 'oos') return true;
  if (incoming.matchStatus === 'blocked') return true;
  if (incoming.matchStatus === 'loading_card') return true;
  return Boolean(incoming.error) && !isOfferWithPrice(incoming);
}

/** next валиден → next; иначе prev. Не затирает рейтинг null-ом при refresh. */
export function mergeOfferRating(
  prev: number | string | null | undefined,
  next: number | string | null | undefined,
): number | null {
  const fromNext = normalizeMarketplaceRating(next);
  if (fromNext != null) return fromNext;
  return normalizeMarketplaceRating(prev);
}

export function mergeOfferReviewCount(
  prev: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next != null && next > 0) return next;
  if (prev != null && prev > 0) return prev;
  return undefined;
}

/** Объединить два предложения, не теряя рейтинг и характеристики */
export function mergeMarketplaceOffers(
  base: MarketplaceOffer | undefined,
  incoming: MarketplaceOffer,
): MarketplaceOffer {
  const incomingIsDirect =
    isOfferWithPrice(incoming) &&
    Boolean(incoming.url) &&
    !isSearchPageUrl(incoming.url) &&
    !incoming.needsManualPick;

  const dropStalePrice = clearsStalePrice(incoming);

  const merged: MarketplaceOffer = {
    marketplace: incoming.marketplace,
    title: preferOfferTitle(incoming.title, base?.title),
    price: isOfferWithPrice(incoming)
      ? incoming.price!
      : dropStalePrice
        ? null
        : (incoming.price ?? base?.price ?? null),
    oldPrice: dropStalePrice ? incoming.oldPrice : (incoming.oldPrice ?? base?.oldPrice),
    basePrice: dropStalePrice ? incoming.basePrice : (incoming.basePrice ?? base?.basePrice),
    payPrice: dropStalePrice ? incoming.payPrice : (incoming.payPrice ?? base?.payPrice),
    delivery: incoming.delivery ?? base?.delivery ?? null,
    rating: mergeOfferRating(base?.rating, incoming.rating),
    reviewCount: mergeOfferReviewCount(base?.reviewCount, incoming.reviewCount),
    url: (() => {
      if (incoming.url && !isSearchPageUrl(incoming.url)) {
        return offerLinkUrl(incoming.url, incoming.marketplace);
      }
      if (incoming.url) {
        return incoming.url;
      }
      // Empty incoming URL on OOS / not_found / blocked — do not resurrect base card URL
      const terminalEmpty =
        incoming.matchStatus === 'oos' ||
        incoming.matchStatus === 'not_found' ||
        incoming.matchStatus === 'blocked' ||
        isOutOfStockError(incoming.error);
      if (terminalEmpty) return '';
      return base?.url ?? '';
    })(),
    imageUrl: incoming.imageUrl ?? base?.imageUrl,
    specs: incoming.specs ?? base?.specs,
    found: isOfferWithPrice(incoming)
      ? true
      : dropStalePrice
        ? false
        : isOfferWithPrice(base) || incoming.found,
    error: dropStalePrice ? incoming.error : (incoming.error ?? base?.error),
    matchConfidence: incoming.matchConfidence ?? base?.matchConfidence,
    matchStatus: incoming.matchStatus ?? base?.matchStatus,
    searchCandidates: incoming.searchCandidates ?? base?.searchCandidates,
    needsManualPick: incoming.needsManualPick ?? base?.needsManualPick,
  };

  // Подтверждённая карточка с ценой сбрасывает устаревший ручной выбор
  if (
    incomingIsDirect ||
    (isOfferWithPrice(merged) &&
      merged.url &&
      !isSearchPageUrl(merged.url) &&
      incoming.needsManualPick === false)
  ) {
    merged.needsManualPick = false;
    merged.searchCandidates = incoming.searchCandidates ?? undefined;
    if (!incoming.error) merged.error = undefined;
    if (incoming.matchStatus) merged.matchStatus = incoming.matchStatus;
    else if (!merged.matchStatus) merged.matchStatus = 'verified';
  }

  // Явный needsManualPick без цены — не тащим старую цену как «найденный» товар;
  // рейтинг: shell / единственный кандидат / предыдущий offer
  if (incoming.needsManualPick && incoming.searchCandidates?.length && !isOfferWithPrice(incoming)) {
    merged.needsManualPick = true;
    merged.searchCandidates = incoming.searchCandidates;
    merged.found = false;
    merged.price = null;
    merged.matchStatus = incoming.matchStatus ?? 'needs_choice';
    const fromShell = normalizeMarketplaceRating(incoming.rating);
    const fromOnly =
      incoming.searchCandidates.length === 1
        ? normalizeMarketplaceRating(incoming.searchCandidates[0]?.rating)
        : null;
    merged.rating = mergeOfferRating(base?.rating, fromShell ?? fromOnly);
    merged.reviewCount = mergeOfferReviewCount(base?.reviewCount, incoming.reviewCount);
  }

  // Явный not_found / loading / oos — не оставляем stale matchStatus/price с base.
  // Исключение: не затирать pending needs_choice + candidates пустым терминалом
  // (stale cloud sync / race после research).
  if (
    incoming.matchStatus === 'not_found' ||
    incoming.matchStatus === 'loading_card' ||
    incoming.matchStatus === 'oos' ||
    incoming.matchStatus === 'blocked'
  ) {
    if (
      isPendingManualChoice(base) &&
      !incomingIsDirect &&
      !isPendingManualChoice(incoming) &&
      !isOfferWithPrice(incoming)
    ) {
      return {
        ...base!,
        title: preferOfferTitle(incoming.title, base!.title),
        rating: mergeOfferRating(base!.rating, incoming.rating),
        reviewCount: mergeOfferReviewCount(base!.reviewCount, incoming.reviewCount),
        needsManualPick: true,
        searchCandidates: base!.searchCandidates,
        matchStatus: 'needs_choice',
        found: false,
        price: null,
      };
    }

    merged.matchStatus = incoming.matchStatus;
    if (incoming.matchStatus !== 'loading_card') {
      merged.needsManualPick = false;
      if (incoming.searchCandidates === undefined) {
        merged.searchCandidates = undefined;
      }
      // Terminal empty — never keep a product-card URL as bound
      if (
        incoming.matchStatus === 'oos' ||
        incoming.matchStatus === 'not_found' ||
        incoming.matchStatus === 'blocked'
      ) {
        merged.url = clearBoundProductPageUrl(incoming.url || merged.url);
      }
    }
    if (incoming.error) merged.error = incoming.error;
  }

  return merged;
}

export function applyOffersToCompareProduct(
  product: CompareProduct,
  offers: MarketplaceOffer[],
): CompareProduct {
  let next: CompareProduct = {
    ...product,
    marketplaceOffers: { ...product.marketplaceOffers },
    marketplaceUrls: { ...product.marketplaceUrls },
  };

  for (const offer of offers) {
    const isProgressOrTerminal =
      offer.matchStatus === 'loading_card' ||
      offer.matchStatus === 'not_found' ||
      offer.matchStatus === 'oos' ||
      offer.matchStatus === 'blocked' ||
      offer.matchStatus === 'needs_choice';

    // Сохраняем not_found / loading / error, чтобы UI не показывал вечное «Нет цены»
    if (!isUsefulOffer(offer) && !offer.found && !offer.error && !isProgressOrTerminal) {
      continue;
    }

    const merged = mergeMarketplaceOffers(next.marketplaceOffers?.[offer.marketplace], offer);
    next = {
      ...next,
      marketplaceOffers: {
        ...next.marketplaceOffers,
        [offer.marketplace]: merged,
      },
    };

    if (isPendingManualChoice(merged) && !next.manualMarketplaces?.[offer.marketplace]) {
      const urls = { ...next.marketplaceUrls };
      delete urls[offer.marketplace];
      next = { ...next, marketplaceUrls: urls };
    } else if (
      merged.matchStatus === 'oos' ||
      merged.matchStatus === 'not_found' ||
      merged.matchStatus === 'blocked'
    ) {
      // Terminal empty / OOS — clear bound URL so next research re-SERPs
      if (!next.manualMarketplaces?.[offer.marketplace]) {
        const urls = { ...next.marketplaceUrls };
        delete urls[offer.marketplace];
        next = { ...next, marketplaceUrls: urls };
      }
    } else if (
      merged.url &&
      !isSearchPageUrl(merged.url) &&
      !merged.needsManualPick &&
      isOfferWithPrice(merged)
    ) {
      next = {
        ...next,
        marketplaceUrls: {
          ...next.marketplaceUrls,
          [offer.marketplace]: merged.url,
        },
      };
    }

    const poolSeeds = [
      ...(merged.url && isOfferWithPrice(merged) && !merged.needsManualPick
        ? [
            {
              title: merged.title,
              url: merged.url,
              price: merged.price,
              matchConfidence: merged.matchConfidence ?? 70,
              imageUrl: merged.imageUrl,
              rating: merged.rating,
            },
          ]
        : []),
      ...(merged.searchCandidates ?? []),
    ];
    if (poolSeeds.length) {
      next = syncPoolOntoProduct(next, offer.marketplace, poolSeeds);
    }
  }

  return next;
}

/** After crash / job end: leftover loading_card → not_found on product. */
export function settleCompareProductLoading(product: CompareProduct): CompareProduct {
  const current = product.marketplaceOffers;
  if (!current) return product;
  let changed = false;
  const nextOffers = { ...current };
  for (const key of Object.keys(nextOffers) as ComparisonMarketplace[]) {
    const offer = nextOffers[key];
    if (!offer || offer.matchStatus !== 'loading_card') continue;
    nextOffers[key] = settleStaleLoadingOffer(offer);
    changed = true;
  }
  if (!changed) return product;
  return { ...product, marketplaceOffers: nextOffers };
}

export function offersFromCompareProduct(product: CompareProduct): MarketplaceOffer[] {
  const marketplaces: ComparisonMarketplace[] = ['wildberries', 'ozon', 'yandex_market'];

  return marketplaces.map((marketplace) => {
    const cached = product.marketplaceOffers?.[marketplace];
    const sourceFallback =
      product.sourceMarketplace === marketplace ? product.sourceOffer : undefined;
    const offer = cached ?? sourceFallback;

    if (offer && (isUsefulOffer(offer) || Boolean(offer.error) || Boolean(offer.matchStatus))) {
      const merged = mergeMarketplaceOffers(undefined, offer);
      return { ...merged, url: offerLinkUrl(merged.url, marketplace) };
    }

    // Empty slot: explicit not_found so UI shows «Найти на …» (not only manual link)
    return {
      marketplace,
      title: product.title,
      price: null,
      delivery: null,
      rating: null,
      url: offerLinkUrl(
        product.marketplaceUrls[marketplace] ??
          (product.sourceMarketplace === marketplace ? product.sourceUrl : undefined) ??
          '',
        marketplace,
      ),
      found: false,
      matchStatus: 'not_found' as const,
      error: DEFAULT_NOT_FOUND_ERROR,
    };
  });
}
