import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import type { CompareProductHint } from '@/types/comparison';
import { getMarketplaceUrl, getBestTitle } from '@/lib/compare-merge';
import {
  applyOffersToCompareProduct,
  ensureOfferWithPrice,
  finalizeResearchOffer,
  isOfferWithPrice,
  isPendingManualChoice,
  mergeMarketplaceOffers,
  normalizeMarketplaceRating,
  offersFromCompareProduct,
} from '@/lib/compare-offers';
import { shouldRunCompare } from '@/lib/compare-cache';
import { enrichOfferFromProductPage, fetchOfferFromUrl } from '@/lib/offer-fetch';
import { inferProductModel } from '@/lib/model-extract';
import { parseAllOzonSearchOffers } from '@/lib/ozon-offer';
import { pickBestMatchWithFallbackScored, pickTopMatchesWithScore, isProductPageUrl, isUrlExcluded, computeMatchConfidence, isAcceptableProductMatch, MIN_COMPARE_MATCH_CONFIDENCE, AUTO_PICK_CONFIDENCE_THRESHOLD, diagnoseMatchFactors, isAliMegaMarketplace, isAliMegaSerpPriceOutlier, isAliMegaCardPriceTooCheap } from '@/lib/product-match';
import { areLineageGenerationsCompatible } from '@/lib/lineage-generation';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import { tryUnambiguousSerpVerified } from '@/lib/serp-auto-pick';
import { verifySerpOfferWithCardCascade } from '@/lib/card-cascade-verify';
import { offerMatchStatus, resolveMatchStatus } from '@/lib/match-status';
import { isTitleCategoryCompatible } from '@/lib/match-category';
import { getEffectiveSearchQuery, buildCrossMarketplaceQueries } from '@/lib/compare-search-query';
import {
  searchViaBrowserTab,
  searchViaOpenProductTab,
  searchViaOpenSerpTab,
} from '@/lib/compare-tab-search';
import { SEARCHING_MP_KEY, SEARCHING_MP_CROSS } from '@/lib/compare-jobs';
import { getSerpCachedOffer, setSerpCachedOffer, clearSerpNotFoundAndExpired } from '@/lib/serp-cache';
import {
  lookupCrossMarketMappings,
  rememberCrossMarketMapping,
  reportCrossMarketMappingFail,
  resolveSourceProductId,
  type CrossMarketMapping,
} from '@/lib/cross-market-map';
import { attachPickHistoryBoosts } from '@/lib/pick-history';
import { pipelineMetrics } from '@/lib/pipeline-metrics';
import { hashQuery, telemetry } from '@/lib/telemetry';
import { COMPARE_MARKETPLACE_CONCURRENCY, mapPool } from '@/lib/async-pool';
import { sortCompareTargets } from '@/lib/compare-target-order';
import { marketplaceSearchSkipReason } from '@/lib/marketplaces/search-gates';
import {
  compareOutcomeFromOfferStatuses,
  trackCompareCompleted,
  trackCompareRejected,
  trackCompareCandidateSelected,
  trackComparisonFailed,
  classifyFailureReason,
} from '@/lib/telemetry/funnel';
import { getSelectedSearchMarketplaces, resolveCompareMarketplaces } from '@/lib/marketplaces/search-settings';
import { reportSearchMetric } from '@/lib/telemetry/flush';
import {
  trackMarketplaceSearchStarted,
  trackMarketplaceSearchFinished,
} from '@/lib/telemetry/ops';
import {
  MAX_CANDIDATE_POOL,
  filterPoolExcluding,
  getCandidatePool,
  getRejectedUrls,
  getRejectedFingerprints,
} from '@/lib/candidate-pool';
import { isIdentityExcluded } from '@/lib/offer-identity';
import { isOutOfStockError, outOfStockOffer } from '@/lib/out-of-stock';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import { buildWbImageUrl, buildWbImageUrlAlternatives } from '@/utils/wb-image';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import { fetchWithRetry, apiErrorMessage, MARKETPLACE_SEARCH_RETRY } from '@/lib/fetch-retry';
import {
  resetEmptyScrape,
  resetAllEmptyScrapes,
  shouldSkipTabScrape,
} from '@/lib/empty-scrape-guard';
import { researchCompareViaEdge } from '@/lib/supabase/compare-research';
import { getSharedPriceCache } from '@/lib/supabase/price-cache';
import { extractArticle } from '@/utils/marketplace';
import { trackCompareMpAttempt } from '@/lib/telemetry/compare-mp-attempt';

export { fetchOfferFromUrl } from '@/lib/offer-fetch';

const WB_DEST = '-1257786';

function rejectWeakMatch(
  offer: MarketplaceOffer,
  referenceTitle: string,
  query: string,
  marketplace: ComparisonMarketplace,
  referenceSpecs?: string,
): MarketplaceOffer {
  if (offer.needsManualPick && offer.searchCandidates?.length) {
    const filtered = offer.searchCandidates.filter((c) =>
      isTitleCategoryCompatible(referenceTitle, c.title ?? '', referenceSpecs),
    );
    if (!filtered.length) {
      telemetry.warn({
        stage: 'match',
        name: 'PRODUCT_MATCH_REJECTED',
        marketplace,
        queryHash: hashQuery(query),
        success: false,
        errorCode: 'category_no_candidates',
        data: { reason: 'no_same_category_in_picker', candidateCount: offer.searchCandidates.length },
      });
      trackCompareRejected(marketplace);
      return notFoundOffer(
        marketplace,
        query,
        buildMarketplaceSearchUrl(marketplace, query),
        'В выдаче нет товаров той же категории',
      );
    }
    telemetry.info({
      stage: 'match',
      name: 'PRODUCT_MATCH_NEEDS_CHOICE',
      marketplace,
      queryHash: hashQuery(query),
      data: { candidateCount: filtered.length, manual: true },
    });
    return {
      ...offer,
      searchCandidates: filtered,
      error:
        filtered.length > 1
          ? `Есть ${filtered.length} похожих варианта — выберите`
          : offer.error,
    };
  }

  if (!offer.found || !offer.title || referenceTitle === 'Товар') return offer;

  if (!isTitleCategoryCompatible(referenceTitle, offer.title, referenceSpecs)) {
    telemetry.warn({
      stage: 'match',
      name: 'PRODUCT_MATCH_REJECTED',
      marketplace,
      queryHash: hashQuery(query),
      success: false,
      errorCode: 'category',
      data: { rejectField: 'category', title: offer.title },
    });
    trackCompareRejected(marketplace);
    return notFoundOffer(
      marketplace,
      query,
      buildMarketplaceSearchUrl(marketplace, query),
      'Категория товара не совпадает',
    );
  }

  const diagnosis = diagnoseMatchFactors(referenceTitle, offer.title, referenceSpecs);
  const confidence =
    offer.matchConfidence ?? diagnosis.confidence;

  if (confidence >= AUTO_PICK_CONFIDENCE_THRESHOLD) {
    const alternatives = offer.searchCandidates?.filter((c) => c.url !== offer.url) ?? [];
    telemetry.info({
      stage: 'match',
      name: 'PRODUCT_MATCH_SELECTED',
      marketplace,
      queryHash: hashQuery(query),
      success: true,
      data: {
        confidence,
        selectionReason: diagnosis.selectionReason,
        brandMatch: diagnosis.brandMatch,
        modelMatch: diagnosis.modelMatch,
        titleSimilarity: diagnosis.titleSimilarity,
      },
    });
    trackCompareCandidateSelected(marketplace);    return {
      ...offer,
      matchConfidence: confidence,
      needsManualPick: false,
      matchStatus: resolveMatchStatus({
        found: true,
        matchConfidence: confidence,
        alternativeCount: alternatives.length,
      }),
      searchCandidates: alternatives.length ? alternatives : offer.searchCandidates,
    };
  }

  const minConfidence =
    offer.url && isProductPageUrl(offer.url) && isOfferWithPrice(offer)
      ? MIN_COMPARE_MATCH_CONFIDENCE
      : MIN_COMPARE_MATCH_CONFIDENCE + 8;

  if (confidence >= minConfidence) {
    telemetry.info({
      stage: 'match',
      name: 'PRODUCT_MATCH_SELECTED',
      marketplace,
      queryHash: hashQuery(query),
      success: true,
      data: {
        confidence,
        selectionReason: diagnosis.selectionReason,
        rejectField: diagnosis.rejectField,
      },
    });
    trackCompareCandidateSelected(marketplace);
    return {
      ...offer,
      matchConfidence: confidence,
      matchStatus: resolveMatchStatus({
        found: true,
        matchConfidence: confidence,
        alternativeCount: offer.searchCandidates?.length ?? 0,
      }),
    };
  }

  telemetry.warn({
    stage: 'match',
    name: 'PRODUCT_MATCH_REJECTED',
    marketplace,
    queryHash: hashQuery(query),
    success: false,
    errorCode: diagnosis.rejectField ?? 'confidence',
    data: {
      confidence,
      rejectField: diagnosis.rejectField ?? 'confidence',
      selectionReason: diagnosis.selectionReason,
      brandMatch: diagnosis.brandMatch,
      modelMatch: diagnosis.modelMatch,
      titleSimilarity: diagnosis.titleSimilarity,
    },
  });
  trackCompareRejected(marketplace);
  return notFoundOffer(
    marketplace,
    query,
    buildMarketplaceSearchUrl(marketplace, query),
    'Не удалось определить товар — укажите ссылку вручную',
  );
}

function normalizeKopecks(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  if (value >= 1000) return Math.round(value / 100);
  return value;
}

/** Параметры поиска с учётом отклонённых карточек */
export interface MarketplaceSearchOptions {
  excludedUrls?: string[];
  excludedFingerprints?: string[];
}

export interface ResolveOfferOptions {
  /** false = только refresh card/pool/mapping, без SERP */
  allowSearch?: boolean;
  /**
   * Research / «Найти заново»: не доверять stale local candidate pool —
   * но cross_market_mapping + price-cache всё равно пробуем до SERP.
   */
  freshSearch?: boolean;
  /** Skip Premium Scrappey unlocker (periodic client backup) */
  skipUnlocker?: boolean;
}

function withMatchConfidence(
  offer: MarketplaceOffer,
  referenceTitle: string,
): MarketplaceOffer {
  if (!offer.title || !referenceTitle || referenceTitle === 'Товар') return offer;
  return {
    ...offer,
    matchConfidence: computeMatchConfidence(referenceTitle, offer.title),
  };
}

/** Собрать Top-N offer из ranked API/DOM кандидатов — см. search-offer-from-candidates */

/** Поисковый запрос с учётом варианта после «не тот товар» */
export function buildSearchQueryForMarketplace(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string {
  return getEffectiveSearchQuery(product, marketplace);
}
function getReferencePrice(product: CompareProduct): number | undefined {
  if (product.sourceOffer?.price && product.sourceOffer.price > 0) {
    return product.sourceOffer.price;
  }

  for (const offer of Object.values(product.marketplaceOffers ?? {})) {
    if (offer?.price && offer.price > 0) return offer.price;
  }

  return undefined;
}

function getReferenceSpecs(product: CompareProduct): string | undefined {
  return (
    product.sourceOffer?.specs ??
    product.marketplaceOffers?.[product.sourceMarketplace]?.specs
  );
}

export function deriveProductModel(product: CompareProduct): string | undefined {
  if (product.productModel) return product.productModel;

  const title = getBestTitle(product);
  const specs =
    product.sourceOffer?.specs ??
    product.marketplaceOffers?.[product.sourceMarketplace]?.specs;

  const info = inferProductModel(title, specs);
  return info.searchQuery.length >= 4 ? info.searchQuery : undefined;
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

/** Сохранённая ссылка на карточку товара (не страница поиска). */
export function getStoredProductPageUrl(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string | undefined {
  const offer = product.marketplaceOffers?.[marketplace];
  const pending = isPendingManualChoice(offer) || offer?.matchStatus === 'needs_choice';
  const isManual = Boolean(product.manualMarketplaces?.[marketplace]);

  // Explicit manual link always counts as bound
  if (isManual) {
    const fromMap = getMarketplaceUrl(product, marketplace);
    if (fromMap && isProductPageUrl(fromMap)) return fromMap;
  }

  // While picker is open, ignore marketplaceUrls / offer.url (may be a candidate card
  // left from older builds — refresh would treat it as bound and wipe searchCandidates).
  if (pending) {
    if (
      product.sourceMarketplace === marketplace &&
      product.sourceUrl &&
      isProductPageUrl(product.sourceUrl)
    ) {
      return product.sourceUrl;
    }
    return undefined;
  }

  // OOS / not_found / blocked: do not treat dead card URL as bound (except manual above).
  // Next research/refresh can SERP instead of re-parsing the same page.
  const terminalEmpty =
    offer?.matchStatus === 'oos' ||
    offer?.matchStatus === 'not_found' ||
    offer?.matchStatus === 'blocked';
  if (terminalEmpty && !isManual) {
    if (
      product.sourceMarketplace === marketplace &&
      product.sourceUrl &&
      isProductPageUrl(product.sourceUrl)
    ) {
      return product.sourceUrl;
    }
    return undefined;
  }

  const fromMap = getMarketplaceUrl(product, marketplace);
  if (fromMap && isProductPageUrl(fromMap)) return fromMap;

  const offerUrl = offer?.url;
  if (offerUrl && isProductPageUrl(offerUrl)) return offerUrl;

  if (
    product.sourceMarketplace === marketplace &&
    product.sourceUrl &&
    isProductPageUrl(product.sourceUrl)
  ) {
    return product.sourceUrl;
  }

  return undefined;
}

/** Оффер с площадки-источника из кэша — без сетевого поиска */
function buildInstantSourceOffer(product: CompareProduct): MarketplaceOffer {
  const marketplace = product.sourceMarketplace;
  const cached = product.sourceOffer ?? product.marketplaceOffers?.[marketplace];
  const url = getStoredProductPageUrl(product, marketplace) ?? product.sourceUrl ?? cached?.url ?? '';

  if (cached && isOfferWithPrice(cached)) {
    return ensureOfferWithPrice({
      ...cached,
      marketplace,
      url: url || cached.url,
      found: true,
      matchConfidence: 100,
      matchStatus: 'verified',
      needsManualPick: false,
      searchCandidates: undefined,
    });
  }

  if (cached?.title && (isOutOfStockError(cached.error) || cached.matchStatus === 'oos')) {
    return outOfStockOffer(marketplace, cached.title, url || cached.url, {
      ...cached,
      marketplace,
      matchStatus: 'oos',
    });
  }

  if (cached?.title) {
    return {
      ...cached,
      marketplace,
      url: url || cached.url,
      found: false,
      price: null,
      matchStatus: cached.matchStatus ?? 'not_found',
      needsManualPick: false,
      searchCandidates: undefined,
    };
  }

  return notFoundOffer(
    marketplace,
    getBestTitle(product),
    url || buildMarketplaceSearchUrl(marketplace, getBestTitle(product)),
    'Нет данных с исходной площадки',
  );
}

async function resolveSourceMarketplaceOffer(
  product: CompareProduct,
  refresh: boolean,
): Promise<MarketplaceOffer> {
  const marketplace = product.sourceMarketplace;
  const productPageUrl = getStoredProductPageUrl(product, marketplace);

  if (!refresh || !productPageUrl) {
    return buildInstantSourceOffer(product);
  }

  try {
    return await refreshKnownProductPage(product, marketplace, productPageUrl);
  } catch {
    return buildInstantSourceOffer(product);
  }
}

/** Обновить цену/рейтинг с уже привязанной карточки — без повторного поиска. */
async function refreshKnownProductPage(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  productUrl: string,
  options: {
    allowStaleCache?: boolean;
    keepCandidates?: MarketplaceOffer['searchCandidates'];
    skipUnlocker?: boolean;
  } = {},
): Promise<MarketplaceOffer> {
  const allowStaleCache = options.allowStaleCache !== false;
  const referenceTitle = getBestTitle(product);
  const cached =
    product.marketplaceOffers?.[marketplace] ??
    (product.sourceMarketplace === marketplace ? product.sourceOffer : undefined);
  const base = mergeMarketplaceOffers(cached, {
    marketplace,
    title: cached?.title ?? referenceTitle,
    price: cached?.price ?? null,
    delivery: cached?.delivery ?? null,
    rating: cached?.rating ?? null,
    url: productUrl,
    found: isOfferWithPrice(cached),
    needsManualPick: false,
    searchCandidates: undefined,
  });

  try {
    const refreshed = await enrichOfferFromProductPage(base, {
      skipUnlocker: options.skipUnlocker,
      forceTab: true,
    });
    if (isOfferWithPrice(refreshed)) {
      return ensureOfferWithPrice({
        ...refreshed,
        url: productUrl,
        searchCandidates: options.keepCandidates?.slice(0, MAX_CANDIDATE_POOL),
      });
    }
    // OOS / empty card — never keep stale priced cache (blocks pool advance / re-SERP)
    if (
      isOutOfStockError(refreshed.error) ||
      refreshed.matchStatus === 'oos' ||
      refreshed.matchStatus === 'not_found'
    ) {
      return finalizeResearchOffer({
        ...refreshed,
        url: productUrl,
        searchCandidates: options.keepCandidates?.slice(0, MAX_CANDIDATE_POOL),
      });
    }
  } catch (error) {
    console.warn('[PriceGuard] refreshKnownProductPage:', error);
  }

  if (allowStaleCache && isOfferWithPrice(cached)) {
    return ensureOfferWithPrice({
      ...cached!,
      url: productUrl,
      searchCandidates: options.keepCandidates?.slice(0, MAX_CANDIDATE_POOL) ?? cached?.searchCandidates,
    });
  }

  return notFoundOffer(
    marketplace,
    referenceTitle,
    productUrl,
    'Товар не найден — добавьте прямую ссылку на карточку',
  );
}

/** Primary URL → local searchCandidates (max 3) до нового поиска.
 *  primaryOnly: только bound URL (режим «Обновить данные») — без тихой подмены.
 *  Иначе fallbacks из пула только при достаточном match score. */
async function refreshWithCandidatePool(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  primaryUrl: string | undefined,
  options: {
    primaryOnly?: boolean;
    referenceTitle?: string;
    referenceSpecs?: string;
    skipUnlocker?: boolean;
  } = {},
): Promise<MarketplaceOffer | null> {
  const cached = product.marketplaceOffers?.[marketplace];
  const referenceTitle = options.referenceTitle ?? getBestTitle(product);
  const referenceSpecs = options.referenceSpecs ?? getReferenceSpecs(product);

  if (options.primaryOnly) {
    if (!primaryUrl || !isProductPageUrl(primaryUrl)) return null;

    // E2: shared price cache before tab/API
    try {
      const pid = extractArticle(primaryUrl, marketplace);
      if (pid) {
        const hit = await getSharedPriceCache(marketplace, pid);
        if (hit?.price && hit.price > 0) {
          return ensureOfferWithPrice({
            marketplace,
            title: hit.title || cached?.title || getBestTitle(product),
            price: hit.price,
            delivery: null,
            rating: hit.rating ?? cached?.rating ?? null,
            url: hit.url || primaryUrl,
            found: true,
            matchStatus: 'verified',
            searchCandidates: cached?.searchCandidates,
          });
        }
      }
    } catch {
      // optional
    }

    const refreshed = await refreshKnownProductPage(product, marketplace, primaryUrl, {
      allowStaleCache: false,
      keepCandidates: cached?.searchCandidates,
      skipUnlocker: options.skipUnlocker,
    });
    if (isOfferWithPrice(refreshed)) {
      return ensureOfferWithPrice(await enrichOfferRatingIfMissing(refreshed));
    }
    // Bound-only refresh: surface OOS / not_found — do not resurrect stale price
    if (
      isOutOfStockError(refreshed.error) ||
      refreshed.matchStatus === 'oos' ||
      refreshed.matchStatus === 'not_found'
    ) {
      return finalizeResearchOffer(refreshed);
    }
    // S1: keep last known SERP/card price if refresh failed for other reasons
    if (isOfferWithPrice(cached) && cached?.url === primaryUrl) {
      return ensureOfferWithPrice({
        ...cached!,
        matchStatus: cached!.matchStatus === 'verified' ? 'serp_only' : cached!.matchStatus ?? 'serp_only',
      });
    }
    return refreshed;
  }

  const poolUrls = [
    primaryUrl,
    ...(cached?.searchCandidates ?? []).map((c) => c.url),
  ]
    .filter((u): u is string => typeof u === 'string' && isProductPageUrl(u))
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, MAX_CANDIDATE_POOL);

  if (!poolUrls.length) return null;

  for (let i = 0; i < poolUrls.length; i++) {
    const url = poolUrls[i]!;
    const fromPool = cached?.searchCandidates?.find((c) => c.url === url);
    const candidateTitle = fromPool?.title ?? (i === 0 ? cached?.title : undefined);

    // Не primary: требуем бренд + min confidence до fetch
    if (i > 0 || (primaryUrl && url !== primaryUrl)) {
      const titleForScore = candidateTitle ?? '';
      if (
        !titleForScore ||
        !isAcceptableProductMatch(referenceTitle, titleForScore, MIN_COMPARE_MATCH_CONFIDENCE, referenceSpecs)
      ) {
        continue;
      }
    }

    const rest = poolUrls
      .filter((u) => u !== url)
      .map((u, idx) => {
        const poolItem = cached?.searchCandidates?.find((c) => c.url === u);
        return {
          title: poolItem?.title ?? cached?.title ?? referenceTitle,
          url: u,
          price: poolItem?.price ?? null,
          matchConfidence: poolItem?.matchConfidence ?? 70,
          priority: poolItem?.priority ?? 90 - idx,
        };
      });

    const refreshed = await refreshKnownProductPage(product, marketplace, url, {
      allowStaleCache: false,
      keepCandidates: rest.length ? rest : undefined,
    });
    // OOS / empty — try next pool URL (caller re-SERPs when all fail → null)
    if (
      isOutOfStockError(refreshed.error) ||
      refreshed.matchStatus === 'oos' ||
      !isOfferWithPrice(refreshed)
    ) {
      continue;
    }
    if (isOfferWithPrice(refreshed)) {
      const title = refreshed.title || candidateTitle || '';
      if (
        i > 0 &&
        title &&
        !isAcceptableProductMatch(referenceTitle, title, MIN_COMPARE_MATCH_CONFIDENCE, referenceSpecs)
      ) {
        continue;
      }
      return ensureOfferWithPrice(await enrichOfferRatingIfMissing({
        ...refreshed,
        matchConfidence:
          refreshed.matchConfidence ??
          (title ? computeMatchConfidence(referenceTitle, title, referenceSpecs) : undefined),
      }));
    }
  }

  return null;
}

function offerFromWbApi(
  nmId: string,
  title: string,
  price: number,
  oldPrice: number | undefined,
  rating: number | null,
  reviewCount: number | undefined,
  delivery: string | null,
  url: string,
): MarketplaceOffer {
  const imageUrl = buildWbImageUrl(nmId);
  return {
    marketplace: 'wildberries',
    title,
    price,
    oldPrice,
    delivery,
    rating,
    reviewCount,
    url,
    imageUrl,
    imageUrlAlternatives: buildWbImageUrlAlternatives(nmId).filter((u) => u !== imageUrl),
    found: true,
  };
}

interface WbSearchProduct {
  id?: number;
  name?: string;
  brand?: string;
  salePriceU?: number;
  priceU?: number;
  reviewRating?: number;
  feedbacks?: number;
  time1?: number;
  time2?: number;
}

function wbDelivery(product: WbSearchProduct): string | null {
  if (!product.time1 || !product.time2) return null;
  return product.time1 === product.time2
    ? `${product.time1} дн.`
    : `${product.time1}–${product.time2} дн.`;
}

function wbTitle(product: WbSearchProduct, fallback: string): string {
  const brand = product.brand?.trim() ?? '';
  const name = product.name?.trim() ?? fallback;
  return brand && !name.toLowerCase().startsWith(brand.toLowerCase())
    ? `${brand} ${name}`
    : name;
}

function wbOfferFromSearchProduct(product: WbSearchProduct, query: string): MarketplaceOffer | null {
  if (!product.id) return null;

  const salePrice = normalizeKopecks(product.salePriceU);
  const basicPrice = normalizeKopecks(product.priceU);
  const price = salePrice || basicPrice;
  if (!price) return null;

  const nmId = String(product.id);

  return offerFromWbApi(
    nmId,
    wbTitle(product, query),
    price,
    basicPrice > price ? basicPrice : undefined,
    normalizeMarketplaceRating(product.reviewRating),
    product.feedbacks,
    wbDelivery(product),
    `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`,
  );
}

export async function resolveOfferForUrl(
  url: string,
  marketplace: ComparisonMarketplace,
  hint?: CompareProductHint,
): Promise<MarketplaceOffer | null> {
  if (hint?.title && hint.price && hint.price > 0) {
    return {
      marketplace,
      title: hint.title,
      price: hint.price,
      oldPrice: hint.oldPrice,
      delivery: null,
      rating: null,
      url,
      found: true,
    };
  }

  // Manual / bound URL: always allow HiddenBrowser (do not inherit cascade empty-scrape skip)
  const fromApi = await fetchOfferFromUrl(url, marketplace, { forceTab: true });
  if (fromApi?.price && fromApi.price > 0) return fromApi;

  if (hint?.title && hint.price) {
    return {
      marketplace,
      title: hint.title,
      price: hint.price,
      oldPrice: hint.oldPrice,
      delivery: null,
      rating: null,
      url,
      found: true,
    };
  }

  return fromApi?.price ? fromApi : null;
}

interface YmSearchProduct {
  titles?: { raw?: string };
  prices?: { value?: string | number };
  slug?: string;
  urls?: { direct?: string };
  rating?: number;
  preciseRating?: number;
  opinions?: number;
  delivery?: { text?: string; options?: Array<{ text?: string }> };
  pictures?: Array<{ original?: { url?: string }; url?: string }>;
  photos?: Array<{ url?: string }>;
  images?: Array<string | { url?: string }>;
}

function extractYmSearchImage(product: YmSearchProduct): string | undefined {
  for (const pic of product.pictures ?? []) {
    const url = pic.original?.url ?? pic.url;
    if (url?.startsWith('http')) return url;
  }
  for (const photo of product.photos ?? []) {
    if (photo.url?.startsWith('http')) return photo.url;
  }
  for (const img of product.images ?? []) {
    if (typeof img === 'string' && img.startsWith('http')) return img;
    if (img && typeof img === 'object' && img.url?.startsWith('http')) return img.url;
  }
  return undefined;
}

function ymProductToOffer(product: YmSearchProduct, fallbackUrl: string): MarketplaceOffer | null {
  const priceRaw = product.prices?.value;
  const price =
    typeof priceRaw === 'number'
      ? priceRaw
      : parseInt(String(priceRaw ?? '').replace(/\D/g, ''), 10);

  if (!price) return null;

  const direct = product.urls?.direct;
  const url =
    direct && isProductPageUrl(direct)
      ? direct
      : isProductPageUrl(fallbackUrl)
        ? fallbackUrl
        : null;

  // Без URL карточки не возвращаем оффер с SERP — иначе откроется поиск
  if (!url) return null;

  return {
    marketplace: 'yandex_market',
    title: product.titles?.raw ?? 'Товар на Яндекс.Маркет',
    price,
    delivery: product.delivery?.text ?? product.delivery?.options?.[0]?.text ?? null,
    rating: normalizeMarketplaceRating(product.rating ?? product.preciseRating),
    reviewCount: product.opinions,
    imageUrl: extractYmSearchImage(product),
    url,
    found: true,
  };
}

function collectYandexProducts(data: unknown): YmSearchProduct[] {
  const results: YmSearchProduct[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const obj = node as Record<string, unknown>;
    if (obj.titles && obj.prices) {
      results.push(obj as YmSearchProduct);
    }

    for (const value of Object.values(obj)) {
      walk(value);
    }
  };

  walk(data);
  return results;
}


async function searchWildberries(
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  searchOptions: MarketplaceSearchOptions = {},
): Promise<MarketplaceOffer> {
  const searchUrl = buildMarketplaceSearchUrl('wildberries', query);

  try {
    const apiUrl =
      `https://search.wb.ru/exactmatch/ru/common/v5/search` +
      `?appType=1&curr=rub&dest=${WB_DEST}&query=${encodeURIComponent(query)}` +
      `&resultset=catalog&sort=popular&spp=30&page=1`;

    const response = await fetchWithRetry(apiUrl, undefined, MARKETPLACE_SEARCH_RETRY);
    if (!response.ok) {
      return notFoundOffer(
        'wildberries',
        query,
        searchUrl,
        apiErrorMessage('Wildberries', response.status),
      );
    }

    const data = (await response.json()) as { data?: { products?: WbSearchProduct[] } };
    const products = data.data?.products ?? [];
    if (!products.length) {
      return notFoundOffer('wildberries', query, searchUrl);
    }

    const wbGetUrl = (p: WbSearchProduct) =>
      p.id ? `https://www.wildberries.ru/catalog/${p.id}/detail.aspx` : undefined;
    const wbGetPrice = (p: WbSearchProduct) =>
      normalizeKopecks(p.salePriceU) || normalizeKopecks(p.priceU) || null;
    const wbGetTitle = (p: WbSearchProduct) => wbTitle(p, query);

    const pickBase = {
      referencePrice,
      excludedUrls: searchOptions.excludedUrls,
      getPrice: (p: unknown) => wbGetPrice(p as WbSearchProduct),
      getUrl: (p: unknown) => wbGetUrl(p as WbSearchProduct),
    };
    const pickOpts = await attachPickHistoryBoosts(
      referenceTitle,
      'wildberries',
      products,
      pickBase,
      wbGetTitle,
    );

    const top = pickTopMatchesWithScore(referenceTitle, products, wbGetTitle, {
      ...pickOpts,
      limit: MAX_CANDIDATE_POOL,
    });

    if (!top.length) {
      // fallback: single best with soft threshold → choice pool for cascade
      const match = pickBestMatchWithFallbackScored(referenceTitle, products, wbGetTitle, pickOpts);
      if (!match) {
        return notFoundOffer('wildberries', query, searchUrl, 'Подходящий товар не найден в выдаче');
      }
      const offer = wbOfferFromSearchProduct(match.item, query);
      if (!offer) return notFoundOffer('wildberries', query, searchUrl);
      return buildOfferFromRankedCandidates('wildberries', query, searchUrl, [
        { offer, confidence: matchConfidencePercent(match.score) },
      ], referenceTitle);
    }

    const ranked = top
      .map(({ item, score }) => {
        const offer = wbOfferFromSearchProduct(item, query);
        if (!offer) return null;
        return { offer, confidence: matchConfidencePercent(score) };
      })
      .filter((r): r is { offer: MarketplaceOffer; confidence: number } => Boolean(r));

    return buildOfferFromRankedCandidates('wildberries', query, searchUrl, ranked, referenceTitle);
  } catch {
    return notFoundOffer('wildberries', query, searchUrl, 'Не удалось подключиться');
  }
}

async function searchOzon(
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  searchOptions: MarketplaceSearchOptions = {},
): Promise<MarketplaceOffer> {
  const searchUrl = buildMarketplaceSearchUrl('ozon', query);

  try {
    const apiUrl =
      `https://www.ozon.ru/api/composer-api.bx/page/json/v2` +
      `?url=${encodeURIComponent(`/search/?text=${query}&deny_category_prediction=true`)}`;

    const response = await fetchWithRetry(apiUrl, {
      headers: { Accept: 'application/json' },
    }, MARKETPLACE_SEARCH_RETRY);
    if (!response.ok) {
      return notFoundOffer('ozon', query, searchUrl, apiErrorMessage('Ozon', response.status));
    }

    const data = (await response.json()) as { widgetStates?: Record<string, string> };
    if (!data.widgetStates) {
      return notFoundOffer('ozon', query, searchUrl);
    }

    const offers = parseAllOzonSearchOffers(data.widgetStates, searchUrl).filter(
      (o) => o.url && isProductPageUrl(o.url),
    );
    if (!offers.length) {
      return notFoundOffer('ozon', query, searchUrl);
    }

    const ozonGetTitle = (o: MarketplaceOffer) => o.title;
    const ozonPickBase = {
      referencePrice,
      excludedUrls: searchOptions.excludedUrls,
      getPrice: (o: unknown) => (o as MarketplaceOffer).price,
      getUrl: (o: unknown) => (o as MarketplaceOffer).url,
    };
    const ozonPickOpts = await attachPickHistoryBoosts(
      referenceTitle,
      'ozon',
      offers,
      ozonPickBase,
      ozonGetTitle,
    );

    const top = pickTopMatchesWithScore(referenceTitle, offers, ozonGetTitle, {
      ...ozonPickOpts,
      limit: MAX_CANDIDATE_POOL,
    });

    if (!top.length) {
      const match = pickBestMatchWithFallbackScored(referenceTitle, offers, ozonGetTitle, ozonPickOpts);
      if (!match) {
        return notFoundOffer('ozon', query, searchUrl, 'Подходящий товар не найден в выдаче');
      }
      return buildOfferFromRankedCandidates('ozon', query, searchUrl, [
        { offer: match.item, confidence: matchConfidencePercent(match.score) },
      ], referenceTitle);
    }

    const ranked = top.map(({ item, score }) => ({
      offer: item,
      confidence: matchConfidencePercent(score),
    }));

    return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked, referenceTitle);
  } catch {
    return notFoundOffer('ozon', query, searchUrl, 'Не удалось подключиться');
  }
}

async function searchYandexMarket(
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  searchOptions: MarketplaceSearchOptions = {},
): Promise<MarketplaceOffer> {
  const searchUrl = buildMarketplaceSearchUrl('yandex_market', query);

  const endpoints = [
    `https://market.yandex.ru/api/v1/search?text=${encodeURIComponent(query)}&cvredirect=1&page=1&numdoc=20`,
    `https://market.yandex.ru/api/resolve/?r=${encodeURIComponent(`/search?text=${query}`)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithRetry(endpoint, {
        headers: { Accept: 'application/json' },
      }, MARKETPLACE_SEARCH_RETRY);
      if (!response.ok) continue;
      const data = await response.json();
      const products = collectYandexProducts(data);

      if (!products.length) continue;

      const offers = products
        .map((p) => ymProductToOffer(p, searchUrl))
        .filter((o): o is MarketplaceOffer => Boolean(o));

      const ymGetTitle = (o: MarketplaceOffer) => o.title;
      const ymPickBase = {
        referencePrice,
        excludedUrls: searchOptions.excludedUrls,
        getPrice: (o: unknown) => (o as MarketplaceOffer).price,
        getUrl: (o: unknown) => (o as MarketplaceOffer).url,
      };
      const ymPickOpts = await attachPickHistoryBoosts(
        referenceTitle,
        'yandex_market',
        offers,
        ymPickBase,
        ymGetTitle,
      );

      const top = pickTopMatchesWithScore(referenceTitle, offers, ymGetTitle, {
        ...ymPickOpts,
        limit: MAX_CANDIDATE_POOL,
      });

      if (top.length) {
        const ranked = top.map(({ item, score }) => ({
          offer: item,
          confidence: matchConfidencePercent(score),
        }));
        return buildOfferFromRankedCandidates('yandex_market', query, searchUrl, ranked, referenceTitle);
      }

      const match = pickBestMatchWithFallbackScored(referenceTitle, offers, ymGetTitle, ymPickOpts);

      if (match) {
        return buildOfferFromRankedCandidates('yandex_market', query, searchUrl, [
          { offer: match.item, confidence: matchConfidencePercent(match.score) },
        ], referenceTitle);
      }
    } catch {
      // continue
    }
  }

  return notFoundOffer(
    'yandex_market',
    query,
    searchUrl,
    'Яндекс.Маркет: товар не найден — добавьте ссылку вручную',
  );
}

async function searchMegamarket(
  query: string,
  _referenceTitle: string,
  _referencePrice?: number,
  _searchOptions: MarketplaceSearchOptions = {},
): Promise<MarketplaceOffer> {
  const searchUrl = buildMarketplaceSearchUrl('megamarket', query);
  // No public search API in MVP — tab SERP only via searchMarketplaceWithFallback.
  return notFoundOffer(
    'megamarket',
    query,
    searchUrl,
    'Мегамаркет: поиск через вкладку',
  );
}

function searchTabOnlyMarketplace(
  marketplace: ComparisonMarketplace,
  query: string,
): MarketplaceOffer {
  const searchUrl = buildMarketplaceSearchUrl(marketplace, query);
  return notFoundOffer(
    marketplace,
    query,
    searchUrl,
    `${marketplace}: поиск через вкладку`,
  );
}

export async function searchMarketplace(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referencePrice?: number,
  searchOptions: MarketplaceSearchOptions = {},
): Promise<MarketplaceOffer> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;

  switch (marketplace) {
    case 'wildberries':
      return searchWildberries(query, ref, referencePrice, searchOptions);
    case 'ozon':
      return searchOzon(query, ref, referencePrice, searchOptions);
    case 'yandex_market':
      return searchYandexMarket(query, ref, referencePrice, searchOptions);
    case 'megamarket':
      return searchMegamarket(query, ref, referencePrice, searchOptions);
    default:
      return searchTabOnlyMarketplace(marketplace, query);
  }
}

/**
 * SERP listing is never a terminal success — open top product cards and re-score.
 * Replaces the old best-effort enrich that kept SERP price when the card failed.
 */
async function finalizeSearchOffer(
  offer: MarketplaceOffer,
  context: {
    referenceTitle: string;
    referenceSpecs?: string;
    referencePrice?: number;
    query: string;
    searchUrl: string;
  },
): Promise<MarketplaceOffer> {
  let result: MarketplaceOffer;
  const alreadyVerified =
    offer.found &&
    !offer.needsManualPick &&
    Boolean(offer.url && isProductPageUrl(offer.url)) &&
    isOfferWithPrice(offer) &&
    (offer.matchConfidence ?? 0) >= AUTO_PICK_CONFIDENCE_THRESHOLD;
  if (alreadyVerified) {
    if (
      isAliMegaMarketplace(offer.marketplace) &&
      (isAliMegaSerpPriceOutlier(context.referencePrice, offer.price) ||
        isAliMegaCardPriceTooCheap(context.referencePrice, offer.price))
    ) {
      result = await verifySerpOfferWithCardCascade(offer, context);
    } else {
      result = offer;
    }
  } else if (offer.needsManualPick && offer.searchCandidates?.length) {
    // Unambiguous SERP pool → bind without opening cards (OOS edge cases still go through cascade
    // when the offer arrived as a single ambiguous / low-confidence shell).
    const fromSerp = tryUnambiguousSerpVerified(
      offer.marketplace,
      offer.searchCandidates.map((c) => ({
        title: c.title,
        url: c.url,
        price: c.price,
        confidence: c.matchConfidence ?? 0,
        imageUrl: c.imageUrl,
        rating: c.rating,
      })),
      { referencePrice: context.referencePrice },
    );
    if (fromSerp) {
      result = fromSerp;
    } else {
      result = await verifySerpOfferWithCardCascade(offer, context);
    }
  } else if (offer.found && offer.url && isProductPageUrl(offer.url)) {
    result = await verifySerpOfferWithCardCascade(offer, context);
  } else if (offer.searchCandidates?.some((c) => c.url && isProductPageUrl(c.url))) {
    result = await verifySerpOfferWithCardCascade(offer, context);
  } else {
    result = offer;
  }

  if (isOfferWithPrice(result) && !result.needsManualPick) {
    return enrichOfferRatingIfMissing(result);
  }
  return result;
}

export async function searchMarketplaceWithFallback(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referencePrice?: number,
  searchOptions: MarketplaceSearchOptions = {},
  referenceSpecs?: string,
): Promise<MarketplaceOffer> {
  const startedAt = Date.now();
  const qHash = hashQuery(query);
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const searchUrl = buildMarketplaceSearchUrl(marketplace, query);
  const errors: string[] = [];

  telemetry.info({
    stage: 'search',
    name: 'SEARCH_STARTED',
    marketplace,
    queryHash: qHash,
    data: { hasExcluded: Boolean(searchOptions.excludedUrls?.length) },
  });
  trackMarketplaceSearchStarted(marketplace);
  telemetry.info({
    stage: 'search',
    name: 'SEARCH_QUERY_BUILT',
    marketplace,
    queryHash: qHash,
    data: { queryLen: query.length },
  });

  const finish = (offer: MarketplaceOffer): MarketplaceOffer => {
    if (offer.needsManualPick) return offer;
    const withConfidence = offer.matchConfidence
      ? offer
      : withMatchConfidence(offer, ref);
    return rejectWeakMatch(withConfidence, ref, query, marketplace, referenceSpecs);
  };

  const cascadeContext = {
    referenceTitle: ref,
    referenceSpecs,
    referencePrice,
    query,
    searchUrl,
  };

  const persistCache = async (offer: MarketplaceOffer): Promise<MarketplaceOffer> => {
    const finished = finish(offer);
    // Only cache verified product cards — never needs_choice / SERP shells
    if (
      finished.found &&
      finished.price != null &&
      finished.price > 0 &&
      finished.url &&
      isProductPageUrl(finished.url) &&
      finished.matchStatus === 'verified'
    ) {
      await setSerpCachedOffer(marketplace, query, ref, finished);
    }
    return finished;
  };

  /** Terminal success only: priced product card after cascade verify */
  const isTerminalVerified = (offer: MarketplaceOffer): boolean =>
    Boolean(
      !offer.needsManualPick &&
        offer.found &&
        isOfferWithPrice(offer) &&
        offer.url &&
        isProductPageUrl(offer.url) &&
        offer.matchStatus === 'verified',
    );

  const emitFinal = (offer: MarketplaceOffer, path: string): MarketplaceOffer => {
    const elapsedMs = Date.now() - startedAt;
    const success = Boolean(
      (offer.found && isOfferWithPrice(offer)) || offer.needsManualPick,
    );
    telemetry.event('FINAL_RESULT', {
      level: success ? 'info' : 'warn',
      stage: 'search',
      marketplace,
      queryHash: qHash,
      success,
      elapsedMs,
      errorCode: offer.error ? 'search_failed' : undefined,
      errorMessage: offer.error ? String(offer.error).slice(0, 160) : undefined,
      data: {
        path,
        matchStatus: offer.matchStatus,
        confidence: offer.matchConfidence,
        needsManualPick: Boolean(offer.needsManualPick),
        candidateCount: offer.searchCandidates?.length ?? 0,
      },
    });
    trackMarketplaceSearchFinished({
      marketplace,
      success,
      elapsedMs,
      reason: offer.error ? String(offer.error).slice(0, 64) : undefined,
    });
    void reportSearchMetric({
      marketplace,
      searchQuery: query.slice(0, 120),
      success,
      responseTimeMs: elapsedMs,
      foundProductId: offer.url ? offer.url.slice(0, 64) : null,
    });
    return offer;
  };

  const cached = await getSerpCachedOffer(marketplace, query, ref);
  if (
    cached &&
    !cached.needsManualPick &&
    cached.found &&
    cached.price != null &&
    cached.price > 0 &&
    cached.url &&
    isProductPageUrl(cached.url) &&
    cached.matchStatus === 'verified'
  ) {
    telemetry.info({
      stage: 'cache',
      name: 'SEARCH_CACHE_HIT',
      marketplace,
      queryHash: qHash,
      success: true,
      data: { matchStatus: cached.matchStatus },
    });
    return emitFinal(finish(cached), 'serp_cache');
  }

  // Each search gets a SERP chance — do not inherit empty-scrape skip from a prior job.
  resetEmptyScrape(marketplace, 'serp');

  const pending = { choice: null as MarketplaceOffer | null };
  let tabAttempted = false;

  const isUsableTabOffer = (offer: MarketplaceOffer): boolean =>
    Boolean(
      (offer.found &&
        isOfferWithPrice(offer) &&
        offer.url &&
        isProductPageUrl(offer.url)) ||
        (offer.needsManualPick && offer.searchCandidates?.length),
    );

  const isTransientApiSearchError = (message: string): boolean =>
    /\b429\b|лимит запросов|ошибка API \(\d+\)|не удалось подключиться к API/i.test(
      message,
    );

  const consumeTabOffer = async (
    tabResult: MarketplaceOffer,
  ): Promise<MarketplaceOffer | null> => {
    if (isUsableTabOffer(tabResult)) {
      void pipelineMetrics.hiddenBrowserSuccess();
      resetEmptyScrape(marketplace, 'serp');
      const finalized = await persistCache(await finalizeSearchOffer(tabResult, cascadeContext));
      if (isTerminalVerified(finalized)) return finalized;
      if (finalized.needsManualPick && finalized.searchCandidates?.length) {
        return finalized;
      }
      if (finalized.error) errors.push(finalized.error);
    } else if (tabResult.error) {
      errors.push(tabResult.error);
    }
    return null;
  };

  const runApiSearch = async (opts: { stashErrors: boolean }): Promise<MarketplaceOffer | null> => {
    const apiStarted = Date.now();
    try {
      const apiResult = await searchMarketplace(
        marketplace,
        query,
        ref,
        referencePrice,
        searchOptions,
      );
      telemetry.info({
        stage: 'search',
        name: 'SEARCH_API_RESPONSE',
        marketplace,
        queryHash: qHash,
        elapsedMs: Date.now() - apiStarted,
        success: Boolean(apiResult.found || apiResult.needsManualPick),
        data: {
          found: Boolean(apiResult.found),
          candidates: apiResult.searchCandidates?.length ?? 0,
          error: apiResult.error ? String(apiResult.error).slice(0, 120) : undefined,
        },
      });
      if (isUsableTabOffer(apiResult)) {
        void pipelineMetrics.apiSearchSuccess();
        const finalized = await persistCache(await finalizeSearchOffer(apiResult, cascadeContext));
        if (isTerminalVerified(finalized)) return finalized;
        if (finalized.needsManualPick && finalized.searchCandidates?.length) {
          pending.choice = finalized;
        } else if (finalized.error && opts.stashErrors) {
          errors.push(finalized.error);
        }
      } else if (
        opts.stashErrors &&
        apiResult.error &&
        !apiResult.error.includes('ограничен') &&
        !isTransientApiSearchError(apiResult.error)
      ) {
        errors.push(apiResult.error);
      }
    } catch {
      if (opts.stashErrors) {
        errors.push(
          apiErrorMessage(
            marketplace === 'wildberries'
              ? 'Wildberries'
              : marketplace === 'ozon'
                ? 'Ozon'
                : 'Яндекс.Маркет',
          ),
        );
      }
      telemetry.warn({
        stage: 'search',
        name: 'SEARCH_API_RESPONSE',
        marketplace,
        queryHash: qHash,
        success: false,
        elapsedMs: Date.now() - apiStarted,
        errorCode: 'api_exception',
      });
    }
    return null;
  };

  const runVisibleSerpSearch = async (): Promise<MarketplaceOffer | null> => {
    const serpStarted = Date.now();
    try {
      const tabResult = await searchViaOpenSerpTab(
        marketplace,
        query,
        ref,
        referencePrice,
        referenceSpecs,
        searchOptions.excludedUrls,
        searchOptions.excludedFingerprints,
      );
      if (!tabResult) return null;
      tabAttempted = true;
      telemetry.info({
        stage: 'serp',
        name: 'SEARCH_CANDIDATES_FOUND',
        marketplace,
        queryHash: qHash,
        elapsedMs: Date.now() - serpStarted,
        success: Boolean(tabResult.found || tabResult.needsManualPick),
        data: {
          path: 'visible_tab',
          found: Boolean(tabResult.found),
          candidates: tabResult.searchCandidates?.length ?? 0,
        },
      });
      return consumeTabOffer(tabResult);
    } catch {
      telemetry.warn({
        stage: 'serp',
        name: 'SEARCH_SERP_FAILED',
        marketplace,
        queryHash: qHash,
        success: false,
        elapsedMs: Date.now() - serpStarted,
        errorCode: 'visible_tab_exception',
      });
      return null;
    }
  };

  const runHiddenSerpSearch = async (): Promise<MarketplaceOffer | null> => {
    const serpStarted = Date.now();
    try {
      void pipelineMetrics.hiddenBrowserAttempt();
      tabAttempted = true;
      const tabResult = await searchViaBrowserTab(
        marketplace,
        query,
        ref,
        referencePrice,
        referenceSpecs,
        searchOptions.excludedUrls,
        searchOptions.excludedFingerprints,
      );
      telemetry.info({
        stage: 'serp',
        name: 'SEARCH_CANDIDATES_FOUND',
        marketplace,
        queryHash: qHash,
        elapsedMs: Date.now() - serpStarted,
        success: Boolean(tabResult.found || tabResult.needsManualPick),
        data: {
          path: 'hidden_browser',
          found: Boolean(tabResult.found),
          candidates: tabResult.searchCandidates?.length ?? 0,
        },
      });
      return consumeTabOffer(tabResult);
    } catch {
      errors.push('Поиск через браузер не удался');
      telemetry.warn({
        stage: 'serp',
        name: 'SEARCH_SERP_FAILED',
        marketplace,
        queryHash: qHash,
        success: false,
        elapsedMs: Date.now() - serpStarted,
        errorCode: 'serp_exception',
      });
    }
    return null;
  };

  // Already-open product card (user found the item) — before SERP.
  try {
    const fromOpenCard = await searchViaOpenProductTab(
      marketplace,
      query,
      ref,
      referenceSpecs,
      searchOptions.excludedUrls,
    );
    if (fromOpenCard && isUsableTabOffer(fromOpenCard)) {
      const finalized = await persistCache(
        await finalizeSearchOffer(fromOpenCard, cascadeContext),
      );
      if (isTerminalVerified(finalized)) {
        trackCompareMpAttempt({
          marketplace,
          path: 'tab',
          success: true,
          reason: 'open_product_verified',
        });
        return emitFinal(finish(finalized), 'open_product_tab');
      }
      if (finalized.needsManualPick && finalized.searchCandidates?.length) {
        trackCompareMpAttempt({
          marketplace,
          path: 'tab',
          success: true,
          reason: 'open_product_choice',
        });
        return emitFinal(finish(finalized), 'open_product_tab');
      }
    }
  } catch {
    // fall through to SERP
  }

  // Tab-only search: already-open SERP of this MP, then HiddenBrowser.
  // search.wb.ru / YM /api/v1/search are not called from SW (429 burns quota).
  // Ozon composer API is last resort after empty tabs; 429 is not stashed into offer.error.
  // P1: after N empty SERPs this research, skip further SERP tabs for this MP.
  if (shouldSkipTabScrape(marketplace, 'serp')) {
    trackCompareMpAttempt({
      marketplace,
      path: 'skip',
      success: false,
      reason: 'serp_empty_budget',
    });
  } else {
    const fromVisible = await runVisibleSerpSearch();
    if (fromVisible) return emitFinal(finish(fromVisible), 'visible_tab');

    if (!shouldSkipTabScrape(marketplace, 'serp')) {
      const fromHidden = await runHiddenSerpSearch();
      if (fromHidden) return emitFinal(finish(fromHidden), 'hidden_browser');
    } else {
      trackCompareMpAttempt({
        marketplace,
        path: 'skip',
        success: false,
        reason: 'serp_empty_budget',
      });
    }
  }

  if (marketplace === 'ozon') {
    const fromApi = await runApiSearch({ stashErrors: !tabAttempted });
    if (fromApi && isTerminalVerified(fromApi)) {
      return emitFinal(finish(fromApi), 'api_fallback');
    }
    if (fromApi) return emitFinal(finish(fromApi), 'api_fallback');
  }

  if (pending.choice?.needsManualPick && pending.choice.searchCandidates?.length) {
    return emitFinal(finish(pending.choice), 'needs_choice');
  }

  return emitFinal(
    finish(
      notFoundOffer(
        marketplace,
        query,
        searchUrl,
        errors.length
          ? errors.join('. ')
          : 'Товар не найден — добавьте прямую ссылку на карточку',
      ),
    ),
    'not_found',
  );
}

/**
 * Prefer known cross-MP binding + shared price cache over SERP.
 * Returns a priced offer when mapping validates; null → caller may search.
 */
export async function tryResolveFromCrossMarketMapping(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  options: {
    referenceTitle?: string;
    referenceSpecs?: string;
    excludedUrls?: string[];
    excludedFingerprints?: string[];
    skipUnlocker?: boolean;
  } = {},
): Promise<MarketplaceOffer | null> {
  if (marketplace === product.sourceMarketplace) return null;

  const referenceTitle = options.referenceTitle ?? getBestTitle(product);
  const referenceSpecs = options.referenceSpecs ?? getReferenceSpecs(product);
  const excludedUrls = options.excludedUrls ?? getRejectedUrls(product, marketplace);
  const excludedFingerprints =
    options.excludedFingerprints ?? getRejectedFingerprints(product, marketplace);

  const sourceId = resolveSourceProductId({
    sourceMarketplace: product.sourceMarketplace,
    sourceUrl: product.sourceUrl,
    article: product.article,
    articlesByMarketplace: product.articlesByMarketplace,
  });
  if (!sourceId) return null;

  let mappedList: CrossMarketMapping[] = [];
  try {
    mappedList = await lookupCrossMarketMappings(
      product.sourceMarketplace,
      sourceId,
      marketplace,
    );
  } catch {
    return null;
  }

  for (const mapped of mappedList.slice(0, MAX_CANDIDATE_POOL)) {
    if (!mapped.targetUrl || !isProductPageUrl(mapped.targetUrl)) continue;
    if (isUrlExcluded(mapped.targetUrl, excludedUrls)) continue;
    if (
      isIdentityExcluded(
        referenceTitle,
        mapped.targetUrl,
        marketplace,
        excludedFingerprints,
      )
    ) {
      continue;
    }

    const keepCandidates = mappedList
      .filter((m) => m.targetUrl !== mapped.targetUrl && !isUrlExcluded(m.targetUrl, excludedUrls))
      .slice(0, MAX_CANDIDATE_POOL - 1)
      .map((m) => ({
        title: referenceTitle,
        url: m.targetUrl,
        price: null as number | null,
        matchConfidence: m.confidence ?? 80,
        priority: 100 - (m.rank ?? 0) * 5,
      }));

    const acceptMapped = (
      offer: MarketplaceOffer,
      evidence: CrossMarketMapping['evidence'],
    ): MarketplaceOffer | null => {
      const mapTitle = offer.title || referenceTitle;
      if (
        !isAcceptableProductMatch(
          referenceTitle,
          mapTitle,
          MIN_COMPARE_MATCH_CONFIDENCE,
          referenceSpecs,
        ) ||
        !areLineageGenerationsCompatible(referenceTitle, mapTitle)
      ) {
        return null;
      }
      void pipelineMetrics.mappingHit();
      return ensureOfferWithPrice({
        ...offer,
        matchConfidence:
          offer.matchConfidence ??
          computeMatchConfidence(referenceTitle, mapTitle, referenceSpecs),
        matchStatus:
          evidence === 'manual' || evidence === 'multi_user'
            ? 'verified'
            : offer.matchStatus ?? 'probable',
        searchCandidates: keepCandidates.length ? keepCandidates : offer.searchCandidates,
      });
    };

    // Shared price cache before opening a card tab
    try {
      const pid =
        mapped.targetProductId || extractArticle(mapped.targetUrl, marketplace);
      if (pid) {
        const hit = await getSharedPriceCache(marketplace, pid);
        if (hit?.price && hit.price > 0) {
          const fromCache = acceptMapped(
            {
              marketplace,
              title: hit.title || referenceTitle,
              price: hit.price,
              delivery: null,
              rating: hit.rating ?? null,
              url: hit.url || mapped.targetUrl,
              found: true,
              matchStatus: 'verified',
            },
            mapped.evidence,
          );
          if (fromCache) {
            telemetry.info({
              stage: 'cache',
              name: 'MAPPING_PRICE_CACHE_HIT',
              marketplace,
              productId: product.id,
              data: { sourceId, targetUrl: mapped.targetUrl.slice(0, 80) },
            });
            return fromCache;
          }
        }
      }
    } catch {
      // cache optional
    }

    const fromMap = await refreshKnownProductPage(product, marketplace, mapped.targetUrl, {
      allowStaleCache: false,
      keepCandidates,
      skipUnlocker: options.skipUnlocker,
    });
    if (isOfferWithPrice(fromMap)) {
      const accepted = acceptMapped(fromMap, mapped.evidence);
      if (accepted) return accepted;
      void reportCrossMarketMappingFail({
        sourceMarketplace: product.sourceMarketplace,
        sourceProductId: sourceId,
        targetMarketplace: marketplace,
        targetUrl: mapped.targetUrl,
      });
      continue;
    }
    void reportCrossMarketMappingFail({
      sourceMarketplace: product.sourceMarketplace,
      sourceProductId: sourceId,
      targetMarketplace: marketplace,
      targetUrl: mapped.targetUrl,
    });
  }

  return null;
}

async function resolveOfferForMarketplace(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  query: string,
  resolveOptions: ResolveOfferOptions = {},
): Promise<MarketplaceOffer> {
  const allowSearch = resolveOptions.allowSearch !== false;
  const freshSearch = Boolean(resolveOptions.freshSearch);
  const referenceTitle = getBestTitle(product);
  const referencePrice = getReferencePrice(product);
  const referenceSpecs = getReferenceSpecs(product);
  const cached = product.marketplaceOffers?.[marketplace];
  const isManualLink = Boolean(product.manualMarketplaces?.[marketplace]);
  const productPageUrl = getStoredProductPageUrl(product, marketplace);
  const excludedUrls = getRejectedUrls(product, marketplace);
  const excludedFingerprints = getRejectedFingerprints(product, marketplace);

  // Ручная ссылка: только обновление карточки, поиск не запускаем
  if (isManualLink) {
    if (productPageUrl && !isUrlExcluded(productPageUrl, excludedUrls)) {
      return refreshKnownProductPage(product, marketplace, productPageUrl, {
        skipUnlocker: resolveOptions.skipUnlocker,
      });
    }
    if (isOfferWithPrice(cached) && cached?.url && !isUrlExcluded(cached.url, excludedUrls)) {
      return ensureOfferWithPrice(cached!);
    }
    return notFoundOffer(
      marketplace,
      referenceTitle,
      buildMarketplaceSearchUrl(marketplace, referenceTitle),
      'Укажите ссылку на карточку вручную',
    );
  }

  // Авто-найденная карточка / candidate pool (без rejected)
  const poolUrls = filterPoolExcluding(getCandidatePool(product, marketplace), excludedUrls);
  const primaryOk =
    productPageUrl && isProductPageUrl(productPageUrl) && !isUrlExcluded(productPageUrl, excludedUrls)
      ? productPageUrl
      : undefined;

  // Режим «Обновить данные»: только bound URL — без подмены из пула / mapping
  if (!allowSearch) {
    // Pending picker must survive refresh / background price backup
    if (isPendingManualChoice(cached)) {
      return finalizeResearchOffer(cached!);
    }
    if (primaryOk) {
      const fromPrimary = await refreshWithCandidatePool(product, marketplace, primaryOk, {
        primaryOnly: true,
        referenceTitle,
        referenceSpecs,
        skipUnlocker: resolveOptions.skipUnlocker,
      });
      if (fromPrimary) return fromPrimary;
    }
    if (isOfferWithPrice(cached) && cached?.url && !isUrlExcluded(cached.url, excludedUrls)) {
      return ensureOfferWithPrice(cached!);
    }
    if (
      marketplace === product.sourceMarketplace &&
      isOfferWithPrice(product.sourceOffer) &&
      product.sourceUrl &&
      !isUrlExcluded(product.sourceUrl, excludedUrls)
    ) {
      return ensureOfferWithPrice(product.sourceOffer!);
    }
    return notFoundOffer(
      marketplace,
      referenceTitle,
      primaryOk || buildMarketplaceSearchUrl(marketplace, referenceTitle),
      'Нет данных — нажмите «Найти заново»',
    );
  }

  // Research: unbound → always SERP (ignore stale pool / mapping)
  if (freshSearch && !primaryOk) {
    // fall through to searchMarketplaceWithFallback below
  } else if (primaryOk || poolUrls.length > 0) {
    // inject filtered candidates into a temp product for refreshWithCandidatePool
    const withFilteredPool: CompareProduct = {
      ...product,
      marketplaceOffers: {
        ...product.marketplaceOffers,
        [marketplace]: {
          ...(cached ?? {
            marketplace,
            title: referenceTitle,
            price: null,
            delivery: null,
            rating: null,
            url: primaryOk ?? '',
            found: false,
          }),
          searchCandidates: poolUrls,
        },
      },
    };
    const fromPool = await refreshWithCandidatePool(
      withFilteredPool,
      marketplace,
      primaryOk,
      { referenceTitle, referenceSpecs },
    );
    if (fromPool) return fromPool;
  }

  if (
    !freshSearch &&
    marketplace === product.sourceMarketplace &&
    isOfferWithPrice(product.sourceOffer) &&
    product.sourceUrl &&
    isProductPageUrl(product.sourceUrl) &&
    !isUrlExcluded(product.sourceUrl, excludedUrls)
  ) {
    const fromSource = await refreshWithCandidatePool(product, marketplace, product.sourceUrl, {
      referenceTitle,
      referenceSpecs,
    });
    if (fromSource) return fromSource;
  }

  // Глобальный кэш соответствий + price-cache — до SERP (в т.ч. при research / freshSearch)
  if (marketplace !== product.sourceMarketplace) {
    const fromMapping = await tryResolveFromCrossMarketMapping(product, marketplace, {
      referenceTitle,
      referenceSpecs,
      excludedUrls,
      excludedFingerprints,
      skipUnlocker: resolveOptions.skipUnlocker,
    });
    if (fromMapping) return fromMapping;
  }

  if (!query || query === 'Товар') {
    return notFoundOffer(
      marketplace,
      referenceTitle,
      buildMarketplaceSearchUrl(marketplace, referenceTitle),
      'Добавьте ссылку на эту площадку',
    );
  }

  // Поиск по нескольким вариантам модели (без артикула чужой площадки)
  const queries =
    marketplace === product.sourceMarketplace
      ? [query]
      : buildCrossMarketplaceQueries(product, marketplace);

  let lastError: string | undefined;

  for (const searchQuery of queries) {
    const searchResult = await searchMarketplaceWithFallback(
      marketplace,
      searchQuery,
      referenceTitle,
      referencePrice,
      { excludedUrls, excludedFingerprints },
      referenceSpecs,
    );
    if (searchResult.needsManualPick && searchResult.searchCandidates?.length) {
      return searchResult;
    }
    if (isOfferWithPrice(searchResult)) {
      const enriched = ensureOfferWithPrice(await enrichOfferRatingIfMissing(searchResult));
      // Пополняем глобальный кэш соответствий
      if (
        marketplace !== product.sourceMarketplace &&
        enriched.url &&
        (enriched.matchConfidence ?? 0) >= AUTO_PICK_CONFIDENCE_THRESHOLD &&
        areLineageGenerationsCompatible(referenceTitle, enriched.title || referenceTitle) &&
        !isUrlExcluded(enriched.url, excludedUrls)
      ) {
        const sourceId = resolveSourceProductId({
          sourceMarketplace: product.sourceMarketplace,
          sourceUrl: product.sourceUrl,
          article: product.article,
          articlesByMarketplace: product.articlesByMarketplace,
        });
        if (sourceId) {
          void rememberCrossMarketMapping({
            sourceMarketplace: product.sourceMarketplace,
            sourceProductId: sourceId,
            sourceUrl: product.sourceUrl,
            targetMarketplace: marketplace,
            targetUrl: enriched.url,
            confidence: enriched.matchConfidence,
            evidence: 'auto',
            alternates: (enriched.searchCandidates ?? [])
              .filter((c) => c.url && c.url !== enriched.url && !isUrlExcluded(c.url, excludedUrls))
              .slice(0, MAX_CANDIDATE_POOL - 1)
              .map((c) => ({ targetUrl: c.url, confidence: c.matchConfidence })),
          });
        }
      }
      return {
        ...enriched,
        searchCandidates: enriched.searchCandidates?.slice(0, MAX_CANDIDATE_POOL),
      };
    }
    lastError = searchResult.error;
  }

  // Артикул — только на площадке-источнике
  if (marketplace === product.sourceMarketplace) {
    const fallbackArticle = product.article?.trim();
    if (fallbackArticle && !queries.includes(fallbackArticle) && fallbackArticle.length >= 4) {
      const byArticle = await searchMarketplaceWithFallback(
        marketplace,
        fallbackArticle,
        referenceTitle,
        referencePrice,
        { excludedUrls },
        referenceSpecs,
      );
      if (isOfferWithPrice(byArticle)) {
        return ensureOfferWithPrice(await enrichOfferRatingIfMissing(byArticle));
      }
      lastError = byArticle.error;
    }
  }

  return notFoundOffer(
    marketplace,
    query,
    buildMarketplaceSearchUrl(marketplace, query),
    lastError ?? 'Товар не найден — укажите ссылку вручную',
  );
}

/** Догружает рейтинг с карточки, если поиск вернул цену без оценки. */
export async function enrichOfferRatingIfMissing(offer: MarketplaceOffer): Promise<MarketplaceOffer> {
  if (!isOfferWithPrice(offer)) return offer;
  if (normalizeMarketplaceRating(offer.rating) != null) return offer;

  const candidates = offer.searchCandidates ?? [];
  const offerUrlNorm = offer.url?.replace(/\/$/, '') ?? '';
  const fromSameUrl = candidates.find((c) => {
    if (!c.url || !offerUrlNorm) return false;
    if (c.url.replace(/\/$/, '') !== offerUrlNorm) return false;
    return normalizeMarketplaceRating(c.rating) != null;
  });
  const fromCandidate =
    normalizeMarketplaceRating(fromSameUrl?.rating) ??
    (candidates.length === 1 ? normalizeMarketplaceRating(candidates[0]?.rating) : null);
  if (fromCandidate != null) {
    return { ...offer, rating: fromCandidate };
  }

  if (!offer.url || !isProductPageUrl(offer.url)) return offer;

  try {
    const enriched = await enrichOfferFromProductPage(offer, { skipUnlocker: true });
    return isOfferWithPrice(enriched) ? enriched : offer;
  } catch {
    return offer;
  }
}

/**
 * Повторный поиск после «Это не тот товар» — игнорирует привязанные URL,
 * пропускает отклонённые карточки, использует следующий вариант запроса.
 */
export async function resolveOfferForMarketplaceAfterReject(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  query: string,
  excludedUrls: string[],
): Promise<MarketplaceOffer> {
  const referenceTitle = getBestTitle(product);
  const referencePrice = getReferencePrice(product);
  const referenceSpecs = getReferenceSpecs(product);
  const excludedFingerprints = getRejectedFingerprints(product, marketplace);

  const searchResult = await searchMarketplaceWithFallback(
    marketplace,
    query,
    referenceTitle,
    referencePrice,
    { excludedUrls, excludedFingerprints },
    referenceSpecs,
  );

  if (isOfferWithPrice(searchResult)) {
    return ensureOfferWithPrice(await enrichOfferRatingIfMissing(searchResult));
  }

  if (searchResult.needsManualPick && searchResult.searchCandidates?.length) {
    return searchResult;
  }

  return notFoundOffer(
    marketplace,
    query,
    buildMarketplaceSearchUrl(marketplace, query),
    searchResult.error ?? 'Другой товар не найден — укажите ссылку вручную',
  );
}

export async function compareProductAcrossMarketplaces(
  product: CompareProduct,
  onProgress?: (product: CompareProduct, offers: MarketplaceOffer[]) => Promise<void> | void,
  options?: {
    refreshSource?: boolean;
    allowSearch?: boolean;
    skipUnlocker?: boolean;
    /** Restrict research/refresh to these target MPs (source always resolved). */
    onlyMarketplaces?: ComparisonMarketplace[];
  },
): Promise<MarketplaceOffer[]> {
  const allowSearch = options?.allowSearch !== false;
  const skipUnlocker = Boolean(options?.skipUnlocker);
  const selected = await getSelectedSearchMarketplaces();
  const allMarketplaces = resolveCompareMarketplaces({
    selected,
    sourceMarketplace: product.sourceMarketplace,
    onlyMarketplaces: options?.onlyMarketplaces,
  });
  const sourceMarketplace = product.sourceMarketplace;
  const targetMarketplaces = allMarketplaces.filter((mp) => mp !== sourceMarketplace);

  const offers: MarketplaceOffer[] = [];
  let currentProduct = product;

  // Площадка-источник: только кэш (или лёгкое обновление карточки при force)
  const sourceOffer = await resolveSourceMarketplaceOffer(product, Boolean(options?.refreshSource));
  offers.push(sourceOffer);
  currentProduct = applyOffersToCompareProduct(currentProduct, offers);
  await onProgress?.(currentProduct, offers);

  if (!targetMarketplaces.length) {
    await chrome.storage.local.remove(SEARCHING_MP_KEY);
    return offers;
  }

  const pending = new Set(targetMarketplaces);
  const setSearchingStatus = async () => {
    if (pending.size === 0) {
      await chrome.storage.local.remove(SEARCHING_MP_KEY);
      return;
    }
    if (pending.size === 1) {
      await chrome.storage.local.set({ [SEARCHING_MP_KEY]: [...pending][0] });
      return;
    }
    await chrome.storage.local.set({ [SEARCHING_MP_KEY]: SEARCHING_MP_CROSS });
  };
  await setSearchingStatus();

  // D: mapping + price-cache before Edge / SERP for unbound targets
  if (allowSearch) {
    for (const mp of [...pending]) {
      if (mp === sourceMarketplace) continue;
      const boundUrl = getStoredProductPageUrl(currentProduct, mp);
      if (boundUrl && isProductPageUrl(boundUrl) && !isUrlExcluded(boundUrl, getRejectedUrls(currentProduct, mp))) {
        continue;
      }
      try {
        const fromMapping = await tryResolveFromCrossMarketMapping(currentProduct, mp, {
          skipUnlocker,
        });
        if (fromMapping && isOfferWithPrice(fromMapping)) {
          const finalized = finalizeResearchOffer(ensureOfferWithPrice(fromMapping));
          offers.push(finalized);
          currentProduct = applyOffersToCompareProduct(currentProduct, [finalized]);
          await onProgress?.(currentProduct, offers);
          pending.delete(mp);
        }
      } catch {
        // mapping optional — fall through to Edge / SERP
      }
    }
    await setSearchingStatus();
    if (pending.size === 0) {
      await chrome.storage.local.remove(SEARCHING_MP_KEY);
      return offers;
    }
  }

  // X2: logged-in server research — only verified cards; needs_choice → local SERP
  if (allowSearch) {
    try {
      const edgeOffers = await researchCompareViaEdge({
        title: getBestTitle(currentProduct),
        sourceMarketplace,
        referencePrice: getReferencePrice(currentProduct),
        sourceUrl: product.sourceUrl,
        targetMarketplaces: [...pending],
      });
      if (edgeOffers) {
        const edgeTitle = getBestTitle(currentProduct);
        const edgeSpecs = getReferenceSpecs(currentProduct);
        for (const mp of targetMarketplaces) {
          if (!pending.has(mp)) continue;
          const edgeOffer = edgeOffers[mp];
          if (!edgeOffer) continue;
          const hasPoolOrPrice =
            (edgeOffer.needsManualPick && Boolean(edgeOffer.searchCandidates?.length)) ||
            Boolean(
              edgeOffer.found &&
                edgeOffer.price &&
                edgeOffer.price > 0 &&
                edgeOffer.url &&
                isProductPageUrl(edgeOffer.url),
            );
          if (!hasPoolOrPrice) continue;

          const query = buildSearchQueryForMarketplace(currentProduct, mp);
          const verified = await verifySerpOfferWithCardCascade(edgeOffer, {
            referenceTitle: edgeTitle,
            referenceSpecs: edgeSpecs,
            referencePrice: getReferencePrice(currentProduct),
            query,
            searchUrl: buildMarketplaceSearchUrl(mp, query),
          });
          if (
            !verified.needsManualPick &&
            verified.found &&
            verified.price != null &&
            verified.price > 0 &&
            verified.url &&
            isProductPageUrl(verified.url) &&
            verified.matchStatus === 'verified'
          ) {
            offers.push(verified);
            currentProduct = applyOffersToCompareProduct(currentProduct, [verified]);
            await onProgress?.(currentProduct, offers);
            pending.delete(mp);
          }
        }
        await setSearchingStatus();
        if (pending.size === 0) {
          await chrome.storage.local.remove(SEARCHING_MP_KEY);
          return offers;
        }
      }
    } catch (error) {
      console.warn('[PriceGuard] compare-research edge:', error);
    }
  }

  const remainingTargets = sortCompareTargets(currentProduct, [...pending]);

  /** Serialize apply+progress so parallel MPs don't clobber each other's snapshot. */
  let progressGate: Promise<void> = Promise.resolve();
  const applyOfferProgress = (nextOffers: MarketplaceOffer[]) => {
    progressGate = progressGate
      .catch(() => undefined)
      .then(async () => {
        currentProduct = applyOffersToCompareProduct(currentProduct, nextOffers);
        try {
          await onProgress?.(currentProduct, offers);
        } catch (err) {
          console.warn('[PriceGuard] compare onProgress:', err);
        }
      });
    return progressGate;
  };

  const resolveTarget = async (marketplace: ComparisonMarketplace): Promise<MarketplaceOffer> => {
    const query = buildSearchQueryForMarketplace(currentProduct, marketplace);
    try {
      const skipReason = marketplaceSearchSkipReason(
        marketplace,
        getBestTitle(currentProduct),
        getReferenceSpecs(currentProduct),
      );
      if (skipReason) {
        trackCompareMpAttempt({
          marketplace,
          path: 'skip',
          success: false,
          reason: 'category_gate',
          productId: currentProduct.id,
        });
        return finalizeResearchOffer(
          notFoundOffer(
            marketplace,
            query,
            buildMarketplaceSearchUrl(marketplace, query),
            skipReason,
          ),
        );
      }

      let offer = await resolveOfferForMarketplace(currentProduct, marketplace, query, {
        allowSearch,
        freshSearch: allowSearch,
        skipUnlocker,
      });
      if (offer.needsManualPick && offer.searchCandidates?.length) {
        return finalizeResearchOffer(offer);
      }
      if (isOfferWithPrice(offer)) {
        // Cascade already opened the card — keep status; never invent verified from serp_only
        try {
          const enriched = await enrichOfferRatingIfMissing(offer);
          return finalizeResearchOffer(
            ensureOfferWithPrice({
              ...enriched,
              matchStatus:
                enriched.matchStatus === 'serp_only'
                  ? 'serp_only'
                  : enriched.matchStatus ?? 'verified',
            }),
          );
        } catch {
          return finalizeResearchOffer(ensureOfferWithPrice(offer));
        }
      }
      return finalizeResearchOffer(offer);
    } catch (error) {
      console.warn(`[PriceGuard] compare ${marketplace}:`, error);
      return finalizeResearchOffer(
        notFoundOffer(
          marketplace,
          query,
          buildMarketplaceSearchUrl(marketplace, query),
          'Ошибка загрузки',
        ),
      );
    } finally {
      pending.delete(marketplace);
      await setSearchingStatus();
    }
  };

  // Limited parallelism (HiddenBrowser); UI updates as each MP settles
  try {
    await mapPool(remainingTargets, COMPARE_MARKETPLACE_CONCURRENCY, async (mp) => {
      const loadingOffer: MarketplaceOffer = {
        marketplace: mp,
        title: getBestTitle(currentProduct),
        price: null,
        delivery: null,
        rating: null,
        url: buildMarketplaceSearchUrl(mp, buildSearchQueryForMarketplace(currentProduct, mp)),
        found: false,
        matchStatus: 'loading_card',
      };
      offers.push(loadingOffer);
      await applyOfferProgress([loadingOffer]);

      const offer = await resolveTarget(mp);
      const idx = offers.findIndex((o) => o.marketplace === mp);
      if (idx >= 0) offers[idx] = offer;
      else offers.push(offer);
      await applyOfferProgress([offer]);
    });
    await progressGate;
  } finally {
    await chrome.storage.local.remove(SEARCHING_MP_KEY);
  }

  // Final pass: any leftover empty slots → explicit not_found (never silent «Нет цены» / «Поиск…»)
  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i]!;
    if (offer.matchStatus === 'loading_card' || (!isOfferWithPrice(offer) && !offer.needsManualPick)) {
      offers[i] = finalizeResearchOffer({
        ...offer,
        matchStatus: offer.matchStatus === 'loading_card' ? undefined : offer.matchStatus,
      });
    }
  }

  return offers;
}

export async function compareAndUpdateProduct(
  product: CompareProduct,
  options?: {
    force?: boolean;
    /** refresh = без SERP; research = полный поиск */
    mode?: 'refresh' | 'research';
    onProgress?: (product: CompareProduct) => Promise<void> | void;
    /** Skip Scrappey unlocker on card refresh (periodic client backup) */
    skipUnlocker?: boolean;
    /** Restrict target search to these marketplaces */
    onlyMarketplaces?: ComparisonMarketplace[];
  },
): Promise<{ offers: MarketplaceOffer[]; product: CompareProduct }> {
  const selected = await getSelectedSearchMarketplaces();
  if (!shouldRunCompare(product, options?.force, selected)) {
    telemetry.info({
      stage: 'cache',
      name: 'COMPARE_CACHE_SKIP',
      productId: product.id,
      marketplace: product.sourceMarketplace,
      data: { force: Boolean(options?.force), comparedAt: product.comparedAt },
    });
    return {
      offers: offersFromCompareProduct(product, { marketplaces: selected }),
      product,
    };
  }

  const mode = options?.mode ?? 'research';
  const allowSearch = mode === 'research';
  const compareStartedAt = Date.now();

  if (allowSearch) {
    await clearSerpNotFoundAndExpired();
    resetAllEmptyScrapes();
    telemetry.info({
      stage: 'job',
      name: 'COMPARE_RESEARCH_START',
      productId: product.id,
      marketplace: product.sourceMarketplace,
      data: { onlyMarketplaces: options?.onlyMarketplaces },
    });
    try {
      const ver = chrome.runtime.getManifest().version;
      console.info('[PriceGuard] compare research start', {
        version: ver,
        productId: product.id,
        onlyMarketplaces: options?.onlyMarketplaces,
      });
    } catch {
      // ignore
    }
  }

  let latestProduct = product;
  try {
    const offers = await compareProductAcrossMarketplaces(
      product,
      async (updated) => {
        latestProduct = updated;
        await options?.onProgress?.(updated);
      },
      {
        refreshSource: options?.force,
        allowSearch,
        skipUnlocker: options?.skipUnlocker,
        onlyMarketplaces: options?.onlyMarketplaces,
      },
    );
    // Apply final offers onto last progressive snapshot (not the original shell only)
    const updated = applyOffersToCompareProduct(latestProduct, offers);
    const productModel = deriveProductModel(updated);

    telemetry.info({
      stage: 'job',
      name: 'COMPARE_DONE',
      productId: product.id,
      data: {
        mode,
        offers: offers.map((o) => ({
          marketplace: o.marketplace,
          matchStatus: o.matchStatus ?? offerMatchStatus(o),
          found: Boolean(o.found && isOfferWithPrice(o)),
          confidence: o.matchConfidence,
          error: o.error ? String(o.error).slice(0, 120) : undefined,
        })),
      },
    });

    trackCompareCompleted(
      compareOutcomeFromOfferStatuses(
        offers.map((o) => o.matchStatus ?? offerMatchStatus(o)),
      ),
      product.sourceMarketplace,
      { durationMs: Date.now() - compareStartedAt },
    );

    console.info('[PriceGuard] compare done', {
      productId: product.id,
      mode,
      offers: offers.map((o) => ({
        marketplace: o.marketplace,
        matchStatus: o.matchStatus ?? offerMatchStatus(o),
        found: Boolean(o.found && isOfferWithPrice(o)),
        price: isOfferWithPrice(o) ? o.price : undefined,
        error: o.error ? String(o.error).slice(0, 160) : undefined,
      })),
    });

    return {
      offers,
      product: productModel
        ? { ...updated, productModel, comparedAt: Date.now() }
        : { ...updated, comparedAt: Date.now() },
    };
  } catch (err) {
    trackComparisonFailed(
      classifyFailureReason(err),
      product.sourceMarketplace,
      Date.now() - compareStartedAt,
    );
    throw err;
  }
}

export function findCheapestOffer(offers: MarketplaceOffer[]): MarketplaceOffer | null {
  const withPrice = offers.filter(
    (o) =>
      isOfferWithPrice(o) &&
      !o.needsManualPick &&
      (o.matchStatus === 'verified' ||
        o.matchStatus === 'probable' ||
        (o.matchConfidence != null && o.matchConfidence >= MIN_COMPARE_MATCH_CONFIDENCE)),
  );
  if (!withPrice.length) return null;
  return withPrice.reduce((best, cur) =>
    (cur.price ?? Infinity) < (best.price ?? Infinity) ? cur : best,
  );
}
