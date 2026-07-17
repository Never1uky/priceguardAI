import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import type { CompareProductHint } from '@/types/comparison';
import { getMarketplaceUrl, getBestTitle } from '@/lib/compare-merge';
import {
  applyOffersToCompareProduct,
  ensureOfferWithPrice,
  isOfferWithPrice,
  mergeMarketplaceOffers,
  offersFromCompareProduct,
} from '@/lib/compare-offers';
import { shouldRunCompare } from '@/lib/compare-cache';
import { enrichOfferFromProductPage, fetchOfferFromUrl } from '@/lib/offer-fetch';
import { inferProductModel } from '@/lib/model-extract';
import { parseAllOzonSearchOffers } from '@/lib/ozon-offer';
import { pickBestMatchWithFallbackScored, pickTopMatchesWithScore, isProductPageUrl, isUrlExcluded, computeMatchConfidence, MIN_COMPARE_MATCH_CONFIDENCE, AUTO_PICK_CONFIDENCE_THRESHOLD } from '@/lib/product-match';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import { resolveMatchStatus } from '@/lib/match-status';
import { getEffectiveSearchQuery, buildCrossMarketplaceQueries } from '@/lib/compare-search-query';
import { searchViaBrowserTab } from '@/lib/compare-tab-search';
import { SEARCHING_MP_KEY, SEARCHING_MP_CROSS } from '@/lib/compare-jobs';
import { getSerpCachedOffer, setSerpCachedOffer, clearSerpNotFoundAndExpired } from '@/lib/serp-cache';
import {
  lookupCrossMarketMappings,
  rememberCrossMarketMapping,
  reportCrossMarketMappingFail,
  resolveSourceProductId,
} from '@/lib/cross-market-map';
import { pipelineMetrics } from '@/lib/pipeline-metrics';
import {
  MAX_CANDIDATE_POOL,
  filterPoolExcluding,
  getCandidatePool,
  getRejectedUrls,
} from '@/lib/candidate-pool';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import { buildWbImageUrl } from '@/utils/wb-image';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import { fetchWithRetry, apiErrorMessage } from '@/lib/fetch-retry';

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
    return offer;
  }

  if (!offer.found || !offer.title || referenceTitle === 'Товар') return offer;

  const confidence =
    offer.matchConfidence ?? computeMatchConfidence(referenceTitle, offer.title, referenceSpecs);

  if (confidence >= AUTO_PICK_CONFIDENCE_THRESHOLD) {
    const alternatives = offer.searchCandidates?.filter((c) => c.url !== offer.url) ?? [];
    return {
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
}

export interface ResolveOfferOptions {
  /** false = только refresh card/pool/mapping, без SERP */
  allowSearch?: boolean;
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
  };
}

/** Сохранённая ссылка на карточку товара (не страница поиска). */
function getStoredProductPageUrl(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string | undefined {
  const fromMap = getMarketplaceUrl(product, marketplace);
  if (fromMap && isProductPageUrl(fromMap)) return fromMap;

  const offerUrl = product.marketplaceOffers?.[marketplace]?.url;
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

  if (cached && (isOfferWithPrice(cached) || cached.title)) {
    return ensureOfferWithPrice({
      ...cached,
      marketplace,
      url: url || cached.url,
      found: isOfferWithPrice(cached),
      matchConfidence: 100,
      matchStatus: 'verified',
      needsManualPick: false,
      searchCandidates: undefined,
    });
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
  options: { allowStaleCache?: boolean; keepCandidates?: MarketplaceOffer['searchCandidates'] } = {},
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
    const refreshed = await enrichOfferFromProductPage(base);
    if (isOfferWithPrice(refreshed)) {
      return ensureOfferWithPrice({
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
    'Не удалось обновить данные с карточки',
  );
}

/** Primary URL → local searchCandidates (max 3) до нового поиска */
async function refreshWithCandidatePool(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  primaryUrl: string | undefined,
): Promise<MarketplaceOffer | null> {
  const cached = product.marketplaceOffers?.[marketplace];
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
    const rest = poolUrls
      .filter((u) => u !== url)
      .map((u) => {
        const fromPool = cached?.searchCandidates?.find((c) => c.url === u);
        return {
          title: fromPool?.title ?? cached?.title ?? getBestTitle(product),
          url: u,
          price: fromPool?.price ?? null,
          matchConfidence: fromPool?.matchConfidence ?? 70,
          priority: fromPool?.priority ?? 90 - i,
        };
      });

    const refreshed = await refreshKnownProductPage(product, marketplace, url, {
      allowStaleCache: false,
      keepCandidates: rest.length ? rest : undefined,
    });
    if (isOfferWithPrice(refreshed)) {
      return ensureOfferWithPrice(refreshed);
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
  return {
    marketplace: 'wildberries',
    title,
    price,
    oldPrice,
    delivery,
    rating,
    reviewCount,
    url,
    imageUrl: buildWbImageUrl(nmId),
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
    product.reviewRating ?? null,
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

  const fromApi = await fetchOfferFromUrl(url, marketplace);
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
    rating: product.rating ?? product.preciseRating ?? null,
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

    const response = await fetchWithRetry(apiUrl);
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

    const top = pickTopMatchesWithScore(referenceTitle, products, (p) => wbTitle(p, query), {
      referencePrice,
      excludedUrls: searchOptions.excludedUrls,
      limit: MAX_CANDIDATE_POOL,
      getPrice: (p) => {
        const item = p as WbSearchProduct;
        const sale = normalizeKopecks(item.salePriceU);
        const basic = normalizeKopecks(item.priceU);
        return sale || basic || null;
      },
      getUrl: (p) => {
        const item = p as WbSearchProduct;
        return item.id
          ? `https://www.wildberries.ru/catalog/${item.id}/detail.aspx`
          : undefined;
      },
    });

    if (!top.length) {
      // fallback: single best with soft threshold
      const match = pickBestMatchWithFallbackScored(referenceTitle, products, (p) => wbTitle(p, query), {
        referencePrice,
        excludedUrls: searchOptions.excludedUrls,
        getPrice: (p) => {
          const item = p as WbSearchProduct;
          return normalizeKopecks(item.salePriceU) || normalizeKopecks(item.priceU) || null;
        },
        getUrl: (p) => {
          const item = p as WbSearchProduct;
          return item.id
            ? `https://www.wildberries.ru/catalog/${item.id}/detail.aspx`
            : undefined;
        },
      });
      if (!match) {
        return notFoundOffer('wildberries', query, searchUrl, 'Подходящий товар не найден в выдаче');
      }
      const offer = wbOfferFromSearchProduct(match.item, query);
      if (!offer) return notFoundOffer('wildberries', query, searchUrl);
      return withMatchConfidence(offer, referenceTitle);
    }

    const ranked = top
      .map(({ item, score }) => {
        const offer = wbOfferFromSearchProduct(item, query);
        if (!offer) return null;
        return { offer, confidence: matchConfidencePercent(score) };
      })
      .filter((r): r is { offer: MarketplaceOffer; confidence: number } => Boolean(r));

    return buildOfferFromRankedCandidates('wildberries', query, searchUrl, ranked);
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
      `?url=${encodeURIComponent(`/search/?text=${query}`)}`;

    const response = await fetchWithRetry(apiUrl, {
      headers: { Accept: 'application/json' },
    });
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

    const top = pickTopMatchesWithScore(referenceTitle, offers, (o) => o.title, {
      referencePrice,
      excludedUrls: searchOptions.excludedUrls,
      limit: MAX_CANDIDATE_POOL,
      getPrice: (o) => (o as MarketplaceOffer).price,
      getUrl: (o) => (o as MarketplaceOffer).url,
    });

    if (!top.length) {
      const match = pickBestMatchWithFallbackScored(referenceTitle, offers, (o) => o.title, {
        referencePrice,
        excludedUrls: searchOptions.excludedUrls,
        getPrice: (o) => (o as MarketplaceOffer).price,
        getUrl: (o) => (o as MarketplaceOffer).url,
      });
      if (!match) {
        return notFoundOffer('ozon', query, searchUrl, 'Подходящий товар не найден в выдаче');
      }
      return withMatchConfidence(match.item, referenceTitle);
    }

    const ranked = top.map(({ item, score }) => ({
      offer: item,
      confidence: matchConfidencePercent(score),
    }));

    return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked);
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
      });
      if (!response.ok) continue;
      const data = await response.json();
      const products = collectYandexProducts(data);

      if (!products.length) continue;

      const offers = products
        .map((p) => ymProductToOffer(p, searchUrl))
        .filter((o): o is MarketplaceOffer => Boolean(o));

      const top = pickTopMatchesWithScore(referenceTitle, offers, (o) => o.title, {
        referencePrice,
        excludedUrls: searchOptions.excludedUrls,
        limit: MAX_CANDIDATE_POOL,
        getPrice: (o) => (o as MarketplaceOffer).price,
        getUrl: (o) => (o as MarketplaceOffer).url,
      });

      if (top.length) {
        const ranked = top.map(({ item, score }) => ({
          offer: item,
          confidence: matchConfidencePercent(score),
        }));
        return buildOfferFromRankedCandidates('yandex_market', query, searchUrl, ranked);
      }

      const match = pickBestMatchWithFallbackScored(referenceTitle, offers, (o) => o.title, {
        referencePrice,
        excludedUrls: searchOptions.excludedUrls,
        getPrice: (o) => (o as MarketplaceOffer).price,
        getUrl: (o) => (o as MarketplaceOffer).url,
      });

      if (match) return withMatchConfidence(match.item, referenceTitle);
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
  }
}

async function finalizeSearchOffer(offer: MarketplaceOffer): Promise<MarketplaceOffer> {
  if (!offer.found || !isOfferWithPrice(offer)) return offer;

  const baseRating = offer.rating;
  const baseReviewCount = offer.reviewCount;
  const basePrice = offer.price;
  const baseOldPrice = offer.oldPrice;

  if (isProductPageUrl(offer.url)) {
    try {
      const enriched = await enrichOfferFromProductPage(offer);
      if (isOfferWithPrice(enriched)) {
        return ensureOfferWithPrice({
          ...enriched,
          rating: enriched.rating ?? baseRating,
          reviewCount: enriched.reviewCount ?? baseReviewCount,
        });
      }
    } catch (error) {
      console.warn('[PriceGuard] finalizeSearchOffer:', error);
    }
  }

  // Данные из выдачи (Ozon и др.) — не терять, если карточка не открылась
  return ensureOfferWithPrice({
    ...offer,
    price: basePrice,
    oldPrice: baseOldPrice,
    rating: baseRating,
    reviewCount: baseReviewCount,
  });
}

export async function searchMarketplaceWithFallback(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referencePrice?: number,
  searchOptions: MarketplaceSearchOptions = {},
  referenceSpecs?: string,
): Promise<MarketplaceOffer> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const searchUrl = buildMarketplaceSearchUrl(marketplace, query);
  const errors: string[] = [];

  const finish = (offer: MarketplaceOffer): MarketplaceOffer => {
    if (offer.needsManualPick) return offer;
    const withConfidence = offer.matchConfidence
      ? offer
      : withMatchConfidence(offer, ref);
    return rejectWeakMatch(withConfidence, ref, query, marketplace, referenceSpecs);
  };

  const cached = await getSerpCachedOffer(marketplace, query, ref);
  if (
    cached &&
    (cached.needsManualPick ||
      (cached.found && cached.url && isProductPageUrl(cached.url)))
  ) {
    return finish(cached);
  }

  const persistCache = async (offer: MarketplaceOffer): Promise<MarketplaceOffer> => {
    const finished = finish(offer);
    // Не кэшируем SERP-URL и notFound — иначе «Найти заново» мгновенно пустой
    if (
      finished.needsManualPick ||
      (finished.found && finished.url && isProductPageUrl(finished.url))
    ) {
      await setSerpCachedOffer(marketplace, query, ref, finished);
    }
    return finished;
  };

  // API-first для всех площадок; HiddenBrowser — редкий fallback (<5% целевых кейсов)
  try {
    const apiResult = await searchMarketplace(
      marketplace,
      query,
      ref,
      referencePrice,
      searchOptions,
    );
    // Принимаем только карточку товара — SERP-URL нельзя считать успехом
    if (
      apiResult.found &&
      isOfferWithPrice(apiResult) &&
      apiResult.url &&
      isProductPageUrl(apiResult.url)
    ) {
      void pipelineMetrics.apiSearchSuccess();
      return persistCache(await finalizeSearchOffer(apiResult));
    }
    if (apiResult.needsManualPick && apiResult.searchCandidates?.length) {
      void pipelineMetrics.apiSearchSuccess();
      return persistCache({
        ...apiResult,
        searchCandidates: apiResult.searchCandidates.slice(0, MAX_CANDIDATE_POOL),
      });
    }
    if (apiResult.error && !apiResult.error.includes('ограничен')) {
      errors.push(apiResult.error);
    }
  } catch {
    errors.push(apiErrorMessage(
      marketplace === 'wildberries' ? 'Wildberries' : marketplace === 'ozon' ? 'Ozon' : 'Яндекс.Маркет',
    ));
  }

  try {
    void pipelineMetrics.hiddenBrowserAttempt();
    const tabResult = await searchViaBrowserTab(
      marketplace,
      query,
      ref,
      referencePrice,
      referenceSpecs,
      searchOptions.excludedUrls,
    );
    if (
      tabResult.found &&
      isOfferWithPrice(tabResult) &&
      (!tabResult.url || isProductPageUrl(tabResult.url) || tabResult.needsManualPick)
    ) {
      void pipelineMetrics.hiddenBrowserSuccess();
      return persistCache(tabResult);
    }
    if (tabResult.needsManualPick && tabResult.searchCandidates?.length) {
      void pipelineMetrics.hiddenBrowserSuccess();
      return persistCache({
        ...tabResult,
        searchCandidates: tabResult.searchCandidates.slice(0, MAX_CANDIDATE_POOL),
      });
    }
    if (tabResult.error) errors.push(tabResult.error);
  } catch {
    errors.push('Поиск через браузер не удался');
  }

  return finish(
    notFoundOffer(
      marketplace,
      query,
      searchUrl,
      errors.length
        ? errors.join('. ')
        : 'Товар не найден — добавьте прямую ссылку на карточку',
    ),
  );
}

async function resolveOfferForMarketplace(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  query: string,
  resolveOptions: ResolveOfferOptions = {},
): Promise<MarketplaceOffer> {
  const allowSearch = resolveOptions.allowSearch !== false;
  const referenceTitle = getBestTitle(product);
  const referencePrice = getReferencePrice(product);
  const referenceSpecs = getReferenceSpecs(product);
  const cached = product.marketplaceOffers?.[marketplace];
  const isManualLink = Boolean(product.manualMarketplaces?.[marketplace]);
  const productPageUrl = getStoredProductPageUrl(product, marketplace);
  const excludedUrls = getRejectedUrls(product, marketplace);

  // Ручная ссылка: только обновление карточки, поиск не запускаем
  if (isManualLink) {
    if (productPageUrl && !isUrlExcluded(productPageUrl, excludedUrls)) {
      return refreshKnownProductPage(product, marketplace, productPageUrl);
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

  if (primaryOk || poolUrls.length > 0) {
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
    );
    if (fromPool) return fromPool;
  }

  if (
    marketplace === product.sourceMarketplace &&
    isOfferWithPrice(product.sourceOffer) &&
    product.sourceUrl &&
    isProductPageUrl(product.sourceUrl) &&
    !isUrlExcluded(product.sourceUrl, excludedUrls)
  ) {
    const fromSource = await refreshWithCandidatePool(product, marketplace, product.sourceUrl);
    if (fromSource) return fromSource;
  }

  // Глобальный кэш соответствий: primary + alternates (skip rejected)
  if (marketplace !== product.sourceMarketplace) {
    const sourceId = resolveSourceProductId({
      sourceMarketplace: product.sourceMarketplace,
      sourceUrl: product.sourceUrl,
      article: product.article,
      articlesByMarketplace: product.articlesByMarketplace,
    });
    if (sourceId) {
      try {
        const mappedList = await lookupCrossMarketMappings(
          product.sourceMarketplace,
          sourceId,
          marketplace,
        );
        for (const mapped of mappedList.slice(0, MAX_CANDIDATE_POOL)) {
          if (!mapped.targetUrl || !isProductPageUrl(mapped.targetUrl)) continue;
          if (isUrlExcluded(mapped.targetUrl, excludedUrls)) continue;
          const fromMap = await refreshKnownProductPage(product, marketplace, mapped.targetUrl, {
            allowStaleCache: false,
            keepCandidates: mappedList
              .filter((m) => m.targetUrl !== mapped.targetUrl && !isUrlExcluded(m.targetUrl, excludedUrls))
              .slice(0, MAX_CANDIDATE_POOL - 1)
              .map((m) => ({
                title: getBestTitle(product),
                url: m.targetUrl,
                price: null,
                matchConfidence: m.confidence ?? 80,
                priority: 100 - (m.rank ?? 0) * 5,
              })),
          });
          if (isOfferWithPrice(fromMap)) {
            void pipelineMetrics.mappingHit();
            return ensureOfferWithPrice({
              ...fromMap,
              matchStatus: mapped.evidence === 'manual' ? 'verified' : fromMap.matchStatus ?? 'probable',
            });
          }
          void reportCrossMarketMappingFail({
            sourceMarketplace: product.sourceMarketplace,
            sourceProductId: sourceId,
            targetMarketplace: marketplace,
            targetUrl: mapped.targetUrl,
          });
        }
      } catch {
        // lookup не должен ломать поиск
      }
    }
  }

  if (!allowSearch) {
    return notFoundOffer(
      marketplace,
      referenceTitle,
      primaryOk || buildMarketplaceSearchUrl(marketplace, referenceTitle),
      'Нет данных — нажмите «Найти заново»',
    );
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
      { excludedUrls },
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
        (enriched.matchConfidence ?? 0) >= AUTO_PICK_CONFIDENCE_THRESHOLD
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
  if (offer.rating != null && offer.rating > 0) return offer;
  if (!offer.url || !isProductPageUrl(offer.url)) return offer;

  try {
    const enriched = await finalizeSearchOffer(offer);
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

  const searchResult = await searchMarketplaceWithFallback(
    marketplace,
    query,
    referenceTitle,
    referencePrice,
    { excludedUrls },
    referenceSpecs,
  );

  if (isOfferWithPrice(searchResult)) {
    return ensureOfferWithPrice(await enrichOfferRatingIfMissing(searchResult));
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
  options?: { refreshSource?: boolean; allowSearch?: boolean },
): Promise<MarketplaceOffer[]> {
  const allowSearch = options?.allowSearch !== false;
  const allMarketplaces: ComparisonMarketplace[] = ['wildberries', 'ozon', 'yandex_market'];
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

  await chrome.storage.local.set({
    [SEARCHING_MP_KEY]: targetMarketplaces.length > 1 ? SEARCHING_MP_CROSS : targetMarketplaces[0],
  });

  const resolveTarget = async (marketplace: ComparisonMarketplace): Promise<MarketplaceOffer> => {
    const query = buildSearchQueryForMarketplace(currentProduct, marketplace);
    try {
      const offer = await resolveOfferForMarketplace(currentProduct, marketplace, query, {
        allowSearch,
      });
      if (offer.needsManualPick && offer.searchCandidates?.length) {
        return offer;
      }
      if (isOfferWithPrice(offer)) {
        return ensureOfferWithPrice(await enrichOfferRatingIfMissing(offer));
      }
      return offer;
    } catch (error) {
      console.warn(`[PriceGuard] compare ${marketplace}:`, error);
      return notFoundOffer(
        marketplace,
        query,
        buildMarketplaceSearchUrl(marketplace, query),
        'Ошибка загрузки',
      );
    }
  };

  // Параллельный поиск только на двух других площадках
  const targetResults = await Promise.all(targetMarketplaces.map((mp) => resolveTarget(mp)));

  for (const offer of targetResults) {
    offers.push(offer);
    currentProduct = applyOffersToCompareProduct(currentProduct, [offer]);
    await onProgress?.(currentProduct, offers);
  }

  await chrome.storage.local.remove(SEARCHING_MP_KEY);

  return offers;
}

export async function compareAndUpdateProduct(
  product: CompareProduct,
  options?: {
    force?: boolean;
    /** refresh = без SERP; research = полный поиск */
    mode?: 'refresh' | 'research';
    onProgress?: (product: CompareProduct) => Promise<void> | void;
  },
): Promise<{ offers: MarketplaceOffer[]; product: CompareProduct }> {
  if (!shouldRunCompare(product, options?.force)) {
    return { offers: offersFromCompareProduct(product), product };
  }

  const mode = options?.mode ?? 'research';
  const allowSearch = mode === 'research';

  if (allowSearch) {
    await clearSerpNotFoundAndExpired();
  }

  const offers = await compareProductAcrossMarketplaces(
    product,
    async (updated) => {
      await options?.onProgress?.(updated);
    },
    { refreshSource: options?.force, allowSearch },
  );
  const updated = applyOffersToCompareProduct(product, offers);
  const productModel = deriveProductModel(updated);

  return {
    offers,
    product: productModel
      ? { ...updated, productModel, comparedAt: Date.now() }
      : { ...updated, comparedAt: Date.now() },
  };
}

export function findCheapestOffer(offers: MarketplaceOffer[]): MarketplaceOffer | null {
  const withPrice = offers.filter((o) => isOfferWithPrice(o));
  if (!withPrice.length) return null;
  return withPrice.reduce((best, cur) =>
    (cur.price ?? Infinity) < (best.price ?? Infinity) ? cur : best,
  );
}
