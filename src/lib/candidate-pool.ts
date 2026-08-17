/**
 * Local candidate pool + rejected blacklist for compare (Variant B).
 */

import type {
  CompareProduct,
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { isOfferWithPrice, isPendingManualChoice } from '@/lib/compare-offers';
import { isUrlExcluded, isProductPageUrl } from '@/lib/product-match';
import { normalizeCompareUrl } from '@/utils/comparison-url';
import { offerIdentityFingerprint } from '@/lib/offer-identity';

export const MAX_CANDIDATE_POOL = 3;
export const MAX_REJECTED_URLS = 20;
export const MAX_REJECTED_FINGERPRINTS = 40;
export const POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizePoolUrl(url: string): string {
  try {
    return normalizeCompareUrl(url);
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

export function getRejectedUrls(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string[] {
  return product.rejectedOfferUrls?.[marketplace] ?? [];
}

export function getRejectedFingerprints(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string[] {
  return product.rejectedOfferFingerprints?.[marketplace] ?? [];
}

export function capRejectedUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const n = normalizePoolUrl(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_REJECTED_URLS) break;
  }
  return out;
}

export function capRejectedFingerprints(fps: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fps) {
    const n = raw.trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_REJECTED_FINGERPRINTS) break;
  }
  return out;
}

export function isPoolFresh(product: CompareProduct, marketplace: ComparisonMarketplace): boolean {
  const at = product.poolFetchedAt?.[marketplace];
  if (!at) return false;
  return Date.now() - at < POOL_TTL_MS;
}

/** Пул: явное поле или searchCandidates на оффере */
export function getCandidatePool(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): SearchCandidateOffer[] {
  const fromField = product.candidatePoolByMarketplace?.[marketplace];
  if (fromField?.length) {
    return fromField.filter((c) => c.url && isProductPageUrl(c.url));
  }
  const fromOffer = product.marketplaceOffers?.[marketplace]?.searchCandidates;
  return (fromOffer ?? []).filter((c) => c.url && isProductPageUrl(c.url));
}

export function filterPoolExcluding(
  pool: SearchCandidateOffer[],
  excludedUrls: string[],
): SearchCandidateOffer[] {
  return pool
    .filter((c) => c.url && !isUrlExcluded(c.url, excludedUrls))
    .sort(
      (a, b) =>
        (b.priority ?? b.matchConfidence) - (a.priority ?? a.matchConfidence) ||
        b.matchConfidence - a.matchConfidence,
    )
    .slice(0, MAX_CANDIDATE_POOL);
}

/** Следующий кандидат после reject (не rejected, не currentUrl) */
export function pickNextPoolCandidate(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  rejectedUrl?: string,
): SearchCandidateOffer | null {
  const excluded = [
    ...getRejectedUrls(product, marketplace),
    ...(rejectedUrl ? [normalizePoolUrl(rejectedUrl)] : []),
  ];
  const pool = filterPoolExcluding(getCandidatePool(product, marketplace), excluded);
  return pool[0] ?? null;
}

export function syncPoolOntoProduct(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  candidates: SearchCandidateOffer[] | undefined,
): CompareProduct {
  const cleaned = filterPoolExcluding(
    candidates ?? [],
    getRejectedUrls(product, marketplace),
  ).slice(0, MAX_CANDIDATE_POOL);

  return {
    ...product,
    candidatePoolByMarketplace: {
      ...product.candidatePoolByMarketplace,
      [marketplace]: cleaned.length ? cleaned : undefined,
    },
    poolFetchedAt: {
      ...product.poolFetchedAt,
      [marketplace]: Date.now(),
    },
  };
}

/** Снять привязку карточки; по умолчанию сохраняет пул (для reject). */
export function clearBoundOffer(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  options: { clearPool?: boolean } = {},
): CompareProduct {
  const marketplaceUrls = { ...product.marketplaceUrls };
  delete marketplaceUrls[marketplace];

  const marketplaceOffers = { ...product.marketplaceOffers };
  const prev = marketplaceOffers[marketplace];
  if (prev) {
    marketplaceOffers[marketplace] = {
      ...prev,
      url: '',
      price: null,
      found: false,
      needsManualPick: false,
      matchStatus: 'not_found',
      searchCandidates: options.clearPool
        ? undefined
        : getCandidatePool(product, marketplace),
      error: undefined,
    };
  }

  const manualMarketplaces = { ...product.manualMarketplaces };
  delete manualMarketplaces[marketplace];

  const candidatePoolByMarketplace = { ...product.candidatePoolByMarketplace };
  const poolFetchedAt = { ...product.poolFetchedAt };
  if (options.clearPool) {
    delete candidatePoolByMarketplace[marketplace];
    delete poolFetchedAt[marketplace];
  }

  return {
    ...product,
    marketplaceUrls,
    marketplaceOffers,
    manualMarketplaces,
    candidatePoolByMarketplace,
    poolFetchedAt,
  };
}

/** Blacklist URL + identity fingerprint; сохранить пул без rejected; опционально bump variant */
export function markOfferRejectedKeepPool(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  rejectedUrl: string,
  options: { bumpSearchVariant?: boolean; rejectedTitle?: string } = {},
): CompareProduct {
  const norm = normalizePoolUrl(rejectedUrl);
  const rejected = capRejectedUrls([
    ...(product.rejectedOfferUrls?.[marketplace] ?? []),
    norm,
  ]);

  const title =
    options.rejectedTitle ??
    product.marketplaceOffers?.[marketplace]?.searchCandidates?.find(
      (c) => normalizePoolUrl(c.url) === norm,
    )?.title ??
    product.marketplaceOffers?.[marketplace]?.title ??
    '';
  const fp = offerIdentityFingerprint(title, rejectedUrl, marketplace);
  const fingerprints = capRejectedFingerprints([
    ...(product.rejectedOfferFingerprints?.[marketplace] ?? []),
    ...(fp ? [fp] : []),
  ]);

  const pool = filterPoolExcluding(getCandidatePool(product, marketplace), rejected);

  let next = clearBoundOffer(product, marketplace);
  next = {
    ...next,
    rejectedOfferUrls: {
      ...next.rejectedOfferUrls,
      [marketplace]: rejected,
    },
    rejectedOfferFingerprints: {
      ...next.rejectedOfferFingerprints,
      [marketplace]: fingerprints,
    },
    candidatePoolByMarketplace: {
      ...next.candidatePoolByMarketplace,
      [marketplace]: pool.length ? pool : undefined,
    },
  };

  if (options.bumpSearchVariant) {
    const variant = (product.searchVariantByMarketplace?.[marketplace] ?? 0) + 1;
    next = {
      ...next,
      searchVariantByMarketplace: {
        ...next.searchVariantByMarketplace,
        [marketplace]: variant,
      },
    };
  }

  return next;
}

/** Очистить bound + пулы на target-площадках для «Найти заново» */
export function clearAllBoundTargets(product: CompareProduct): CompareProduct {
  const targets: ComparisonMarketplace[] = ['wildberries', 'ozon', 'yandex_market'];
  let next = product;
  for (const mp of targets) {
    if (mp === product.sourceMarketplace) continue;
    next = clearBoundOffer(next, mp, { clearPool: true });
  }
  return next;
}

/** Слот сохраняется при «Найти заново»: ручная ссылка или подтверждённая карточка с ценой. */
export function isResearchPreservedSlot(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): boolean {
  if (product.manualMarketplaces?.[marketplace]) return true;
  const offer = product.marketplaceOffers?.[marketplace];
  if (!offer) return false;
  return (
    offer.matchStatus === 'verified' &&
    isOfferWithPrice(offer) &&
    Boolean(offer.url) &&
    isProductPageUrl(offer.url) &&
    !offer.needsManualPick
  );
}

function urlsLooselyMatch(a: string, b: string): boolean {
  const na = normalizePoolUrl(a);
  const nb = normalizePoolUrl(b);
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
}

/**
 * Find a compare row that still has needs_choice and lists this URL as a candidate
 * (user opened candidate in a tab → ENSURE must not wipe the picker).
 */
export function findPendingChoiceForProductUrl(
  products: CompareProduct[],
  url: string,
): { product: CompareProduct; marketplace: ComparisonMarketplace } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  for (const product of products) {
    for (const mp of ['wildberries', 'ozon', 'yandex_market'] as ComparisonMarketplace[]) {
      const offer = product.marketplaceOffers?.[mp];
      if (!isPendingManualChoice(offer)) continue;
      const fromOffer = offer!.searchCandidates ?? [];
      const fromPool = product.candidatePoolByMarketplace?.[mp] ?? [];
      const hit = [...fromOffer, ...fromPool].some((c) => c.url && urlsLooselyMatch(c.url, trimmed));
      if (hit) return { product, marketplace: mp };
    }
  }
  return null;
}

/** «Найти заново»: сброс только авто-слотов; manual / verified + price остаются. */
export function researchClearAutoOnly(
  product: CompareProduct,
  options?: { preservePendingChoice?: boolean },
): CompareProduct {
  const targets: ComparisonMarketplace[] = ['wildberries', 'ozon', 'yandex_market'];
  let next = product;
  for (const mp of targets) {
    if (mp === product.sourceMarketplace) continue;
    if (isResearchPreservedSlot(next, mp)) continue;
    // ENSURE / soft re-entry: keep open picker (explicit «Найти заново» clears it)
    if (options?.preservePendingChoice && isPendingManualChoice(next.marketplaceOffers?.[mp])) {
      continue;
    }
    next = clearBoundOffer(next, mp, { clearPool: true });
  }
  return next;
}

export function poolToOfferCandidates(
  pool: SearchCandidateOffer[],
  excludeUrl?: string,
): SearchCandidateOffer[] {
  const excluded = excludeUrl ? [normalizePoolUrl(excludeUrl)] : [];
  return filterPoolExcluding(pool, excluded);
}

export function offerFromPoolCandidate(
  marketplace: ComparisonMarketplace,
  candidate: SearchCandidateOffer,
  rest: SearchCandidateOffer[],
): MarketplaceOffer {
  return {
    marketplace,
    title: candidate.title,
    price: candidate.price,
    delivery: null,
    rating: candidate.rating ?? null,
    url: candidate.url,
    imageUrl: candidate.imageUrl,
    found: Boolean(candidate.price && candidate.price > 0),
    matchConfidence: candidate.matchConfidence,
    matchStatus: 'probable',
    searchCandidates: rest.length ? rest : undefined,
    needsManualPick: false,
  };
}
