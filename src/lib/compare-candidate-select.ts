/**
 * Выбор кандидата из топ-3 SERP после низкого confidence.
 */
import { applyOffersToCompareProduct, isOfferWithPrice } from '@/lib/compare-offers';
import { enrichOfferRatingIfMissing } from '@/lib/marketplace-search';
import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import { computeMatchConfidence } from '@/lib/product-match';
import { rememberCrossMarketMapping, resolveSourceProductId } from '@/lib/cross-market-map';
import { recordMatchFeedback } from '@/lib/match-feedback';
import { getCompareProducts, saveCompareProducts } from '@/lib/comparison-storage';
import { getBestTitle } from '@/lib/compare-merge';
import { isOutOfStockError } from '@/lib/out-of-stock';
import { rememberPickHistory } from '@/lib/pick-history';
import { normalizeCompareUrl as normalizeUrlForMatch } from '@/utils/comparison-url';
import type {
  CompareProduct,
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import {
  detectComparisonMarketplace,
  extractComparisonArticle,
  normalizeCompareUrl,
  resolveCompareCandidateUrl,
} from '@/utils/comparison-url';

export interface SelectCandidateHint {
  title?: string;
  price?: number | null;
  imageUrl?: string;
  rating?: number | null;
}

export class ComparePickNetworkError extends Error {
  constructor(message = 'Ошибка сети при загрузке карточки') {
    super(message);
    this.name = 'ComparePickNetworkError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function urlsMatch(a: string, b: string): boolean {
  const na = normalizeUrlForMatch(a);
  const nb = normalizeUrlForMatch(b);
  return na === nb || a === b || na.includes(b) || nb.includes(a);
}

function findStoredCandidate(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  candidateUrl: string,
): SearchCandidateOffer | undefined {
  const fromOffer = product.marketplaceOffers?.[marketplace]?.searchCandidates ?? [];
  const fromPool = product.candidatePoolByMarketplace?.[marketplace] ?? [];
  const pool = [...fromOffer, ...fromPool];
  return pool.find((c) => urlsMatch(c.url, candidateUrl));
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof ComparePickNetworkError) return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('ошибка сети')
  );
}

async function fetchCardWithRetry(
  url: string,
  marketplace: ComparisonMarketplace,
  skipUnlocker: boolean,
): Promise<MarketplaceOffer | null> {
  const delays = [0, 300, 800];
  let lastError: unknown;
  for (const wait of delays) {
    if (wait) await delay(wait);
    try {
      return await fetchOfferFromUrl(url, marketplace, { skipUnlocker });
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error)) return null;
    }
  }
  if (lastError && isNetworkError(lastError)) {
    throw new ComparePickNetworkError();
  }
  return null;
}

export async function selectCompareSearchCandidate(
  productId: string,
  marketplace: ComparisonMarketplace,
  candidateUrl: string,
  uiHint?: SelectCandidateHint,
): Promise<CompareProduct> {
  const absoluteUrl = resolveCompareCandidateUrl(candidateUrl, marketplace);
  const trimmedUrl = absoluteUrl.trim();
  const detected = detectComparisonMarketplace(trimmedUrl);

  if (!detected) {
    throw new Error('Некорректная ссылка на карточку');
  }

  if (detected !== marketplace) {
    throw new Error('Ссылка не соответствует выбранной площадке');
  }

  const products = await getCompareProducts();
  const product = products.find((p) => p.id === productId);
  if (!product) {
    throw new Error('Товар не найден в списке сравнения');
  }

  const normalizedUrl = normalizeCompareUrl(trimmedUrl);
  const stored = findStoredCandidate(product, marketplace, normalizedUrl);
  const hint: SelectCandidateHint = {
    title: uiHint?.title || stored?.title,
    price: uiHint?.price ?? stored?.price ?? null,
    imageUrl: uiHint?.imageUrl || stored?.imageUrl,
    rating: uiHint?.rating ?? stored?.rating ?? null,
  };

  const hasSerpPrice = hint.price != null && hint.price > 0;
  // E4: with SERP price — never burn Premium unlocker
  const fromCard = await fetchCardWithRetry(normalizedUrl, marketplace, hasSerpPrice);

  let offer: MarketplaceOffer | null = null;
  let usedSerpOnly = false;

  // OOS card → never promote SERP price into an alertable priced offer
  if (isOutOfStockError(fromCard?.error)) {
    throw new Error('Товар недоступен / нет в наличии по этой ссылке');
  }

  if (fromCard && isOfferWithPrice(fromCard)) {
    offer = fromCard;
  } else if (hasSerpPrice) {
    usedSerpOnly = true;
    offer = {
      ...candidateOfferFromUrl(
        marketplace,
        normalizedUrl,
        hint.title || getBestTitle(product),
        hint.price!,
        stored?.matchConfidence ?? 80,
      ),
      imageUrl: hint.imageUrl,
      rating: hint.rating ?? null,
      matchStatus: 'serp_only',
    };
  }

  if (!offer || !isOfferWithPrice(offer)) {
    throw new Error('Не удалось загрузить данные с карточки');
  }

  const referenceTitle = getBestTitle(product);
  const confidence = computeMatchConfidence(referenceTitle, offer.title ?? referenceTitle);

  offer = {
    ...offer,
    url: normalizedUrl,
    found: true,
    matchConfidence: confidence,
    matchStatus: usedSerpOnly ? 'serp_only' : 'verified',
    needsManualPick: false,
    searchCandidates: undefined,
    error: undefined,
  };

  try {
    offer = await enrichOfferRatingIfMissing(offer);
    if (!usedSerpOnly) offer = { ...offer, matchStatus: 'verified' };
  } catch {
    // keep SERP/card offer as-is
  }

  const article = extractComparisonArticle(normalizedUrl, marketplace) || undefined;
  const updated = applyOffersToCompareProduct(product, [offer]);

  const withMeta: CompareProduct = {
    ...updated,
    marketplaceUrls: { ...updated.marketplaceUrls, [marketplace]: normalizedUrl },
    articlesByMarketplace: article
      ? { ...updated.articlesByMarketplace, [marketplace]: article }
      : updated.articlesByMarketplace,
    manualMarketplaces: { ...updated.manualMarketplaces, [marketplace]: true },
    comparedAt: Date.now(),
  };

  await saveCompareProducts([withMeta, ...products.filter((p) => p.id !== productId)]);

  void rememberPickHistory({
    referenceTitle,
    marketplace,
    url: normalizedUrl,
    title: offer.title,
  });

  if (marketplace !== product.sourceMarketplace) {
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
        targetUrl: normalizedUrl,
        confidence: Math.max(confidence, 90),
        evidence: 'manual',
      });
      void recordMatchFeedback({
        sourceMarketplace: product.sourceMarketplace,
        sourceProductId: sourceId,
        targetMarketplace: marketplace,
        candidateUrl: normalizedUrl,
        accepted: true,
        matchConfidence: confidence,
      });
    }
  }

  return withMeta;
}

export function candidateOfferFromUrl(
  marketplace: ComparisonMarketplace,
  url: string,
  title: string,
  price: number | null,
  matchConfidence: number,
): MarketplaceOffer {
  return {
    marketplace,
    title,
    price,
    delivery: null,
    rating: null,
    url,
    found: Boolean(price && price > 0),
    matchConfidence,
    needsManualPick: false,
  };
}
