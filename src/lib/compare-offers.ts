import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { isSearchPageUrl } from '@/lib/product-match';
import { offerLinkUrl } from '@/utils/product-url';
import { syncPoolOntoProduct } from '@/lib/candidate-pool';

export function isOfferWithPrice(offer: MarketplaceOffer | null | undefined): boolean {
  return Boolean(offer && offer.price != null && offer.price > 0);
}

/** Рейтинг площадки 1–5; мусор вроде 14.2 → null */
export function normalizeMarketplaceRating(
  rating: number | null | undefined,
): number | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  return Math.round(rating * 10) / 10;
}

export function isUsefulOffer(offer: MarketplaceOffer | null | undefined): boolean {
  if (!offer) return false;
  if (offer.needsManualPick && offer.searchCandidates?.length) return true;
  return isOfferWithPrice(offer) || hasRating(offer) || Boolean(offer.specs);
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

function pickRating(
  incoming: number | null | undefined,
  base: number | null | undefined,
): number | null {
  const fromIncoming = normalizeMarketplaceRating(incoming);
  if (fromIncoming != null) return fromIncoming;
  return normalizeMarketplaceRating(base);
}

function pickReviewCount(
  incoming: number | undefined,
  base: number | undefined,
): number | undefined {
  if (incoming != null && incoming > 0) return incoming;
  if (base != null && base > 0) return base;
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

  const merged: MarketplaceOffer = {
    marketplace: incoming.marketplace,
    title: incoming.title || base?.title || 'Товар',
    price: incoming.price ?? base?.price ?? null,
    oldPrice: incoming.oldPrice ?? base?.oldPrice,
    basePrice: incoming.basePrice ?? base?.basePrice,
    payPrice: incoming.payPrice ?? base?.payPrice,
    delivery: incoming.delivery ?? base?.delivery ?? null,
    rating: pickRating(incoming.rating, base?.rating),
    reviewCount: pickReviewCount(incoming.reviewCount, base?.reviewCount),
    url:
      incoming.url && !isSearchPageUrl(incoming.url)
        ? offerLinkUrl(incoming.url, incoming.marketplace)
        : (base?.url ?? offerLinkUrl(incoming.url, incoming.marketplace)),
    imageUrl: incoming.imageUrl ?? base?.imageUrl,
    specs: incoming.specs ?? base?.specs,
    found: isOfferWithPrice(incoming) || isOfferWithPrice(base) || incoming.found,
    error: incoming.error ?? base?.error,
    matchConfidence: incoming.matchConfidence ?? base?.matchConfidence,
    matchStatus: incoming.matchStatus ?? base?.matchStatus,
    searchCandidates: incoming.searchCandidates ?? base?.searchCandidates,
    needsManualPick: incoming.needsManualPick ?? base?.needsManualPick,
  };

  // Подтверждённая карточка с ценой сбрасывает устаревший ручной выбор
  if (incomingIsDirect || (isOfferWithPrice(merged) && merged.url && !isSearchPageUrl(merged.url) && incoming.needsManualPick === false)) {
    merged.needsManualPick = false;
    merged.searchCandidates = incoming.searchCandidates ?? undefined;
    if (!incoming.error) merged.error = undefined;
    if (incoming.matchStatus) merged.matchStatus = incoming.matchStatus;
    else if (!merged.matchStatus) merged.matchStatus = 'verified';
  }

  // Явный needsManualPick без цены — не тащим старую цену/рейтинг как «найденный» товар
  if (incoming.needsManualPick && incoming.searchCandidates?.length && !isOfferWithPrice(incoming)) {
    merged.needsManualPick = true;
    merged.searchCandidates = incoming.searchCandidates;
    merged.found = false;
    merged.rating = null;
    merged.reviewCount = undefined;
    merged.price = null;
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
    // Сохраняем not_found с error, чтобы UI показал «Не найдено», а не пустое «Нет цены»
    if (!isUsefulOffer(offer) && !offer.found && !offer.error) continue;

    const merged = mergeMarketplaceOffers(next.marketplaceOffers?.[offer.marketplace], offer);
    next = {
      ...next,
      marketplaceOffers: {
        ...next.marketplaceOffers,
        [offer.marketplace]: merged,
      },
    };

    if (merged.url && !isSearchPageUrl(merged.url) && !merged.needsManualPick) {
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

export function offersFromCompareProduct(product: CompareProduct): MarketplaceOffer[] {
  const marketplaces: ComparisonMarketplace[] = ['wildberries', 'ozon', 'yandex_market'];

  return marketplaces.map((marketplace) => {
    const cached = product.marketplaceOffers?.[marketplace];
    const sourceFallback =
      product.sourceMarketplace === marketplace ? product.sourceOffer : undefined;
    const offer = cached ?? sourceFallback;

    if (offer && (isUsefulOffer(offer) || Boolean(offer.error))) {
      const merged = mergeMarketplaceOffers(undefined, offer);
      return { ...merged, url: offerLinkUrl(merged.url, marketplace) };
    }

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
    };
  });
}
