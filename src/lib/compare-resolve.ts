import { findDuplicateCompareProduct, mergeCompareProducts, getBestTitle } from '@/lib/compare-merge';
import { canAddCompareProduct } from '@/lib/subscription';
import { getCompareProducts, saveCompareProducts } from '@/lib/comparison-storage';
import { applyOffersToCompareProduct, isOfferWithPrice } from '@/lib/compare-offers';
import { resolveOfferForUrl } from '@/lib/marketplace-search';
import { inferProductModel, areBrandsCompatible } from '@/lib/model-extract';
import {
  computeMatchConfidence,
  MANUAL_LINK_CONFIRM_CONFIDENCE,
} from '@/lib/product-match';
import type {
  CompareProduct,
  CompareProductHint,
  ComparisonMarketplace,
  MarketplaceOffer,
} from '@/types/comparison';
import { COMPARISON_MARKETPLACE_LABELS } from '@/types/comparison';
import {
  detectComparisonMarketplace,
  extractComparisonArticle,
  normalizeCompareUrl,
  resolveCompareCandidateUrl,
} from '@/utils/comparison-url';
import { rememberCrossMarketMapping, resolveSourceProductId } from '@/lib/cross-market-map';
import { recordMatchFeedback } from '@/lib/match-feedback';
import { rememberPickHistory } from '@/lib/pick-history';
import { ensureCompareProductImage } from '@/lib/product-image';
import { clearPriceHistory } from '@/lib/storage-local';
import { stableProductStorageId } from '@/lib/price-identity';
import type { Marketplace } from '@/types/product';

export class ManualLinkNeedsConfirmError extends Error {
  readonly code = 'MANUAL_LINK_NEEDS_CONFIRM' as const;
  readonly referenceTitle: string;
  readonly fetchedTitle: string;
  readonly confidence: number;

  constructor(referenceTitle: string, fetchedTitle: string, confidence: number) {
    super(
      `Это тот же товар, что «${referenceTitle.slice(0, 80)}»?\nСейчас по ссылке: «${fetchedTitle.slice(0, 80)}»`,
    );
    this.name = 'ManualLinkNeedsConfirmError';
    this.referenceTitle = referenceTitle;
    this.fetchedTitle = fetchedTitle;
    this.confidence = confidence;
  }
}
function offerFromHint(
  marketplace: ComparisonMarketplace,
  url: string,
  hint: CompareProductHint,
): MarketplaceOffer | null {
  const title = hint.title?.trim();
  if (!title || !hint.price || hint.price <= 0) return null;

  return {
    marketplace,
    title,
    price: hint.price,
    oldPrice: hint.oldPrice,
    delivery: null,
    rating: null,
    url,
    found: true,
  };
}

export async function buildCompareProductFromUrl(
  url: string,
  articleOverride?: string,
  hint?: CompareProductHint,
): Promise<CompareProduct> {
  const trimmedUrl = url.trim();
  const marketplace = detectComparisonMarketplace(trimmedUrl);

  if (!marketplace) {
    throw new Error('Поддерживаются ссылки Wildberries, Ozon и Яндекс.Маркет');
  }

  const normalizedUrl = normalizeCompareUrl(trimmedUrl);
  const extractedArticle = extractComparisonArticle(trimmedUrl, marketplace);
  const article = articleOverride?.trim() || extractedArticle || undefined;

  const fromHint = hint ? offerFromHint(marketplace, normalizedUrl, hint) : null;
  let sourceOffer: MarketplaceOffer;

  if (fromHint) {
    sourceOffer = {
      ...fromHint,
      needsManualPick: false,
      searchCandidates: undefined,
      matchConfidence: 100,
      matchStatus: 'verified',
      found: true,
    };
  } else {
    const resolvedOffer = await resolveOfferForUrl(normalizedUrl, marketplace, hint);

    if (!resolvedOffer || !isOfferWithPrice(resolvedOffer)) {
      throw new Error(
        'Не удалось загрузить карточку товара. Откройте ссылку в браузере и убедитесь, что страница доступна.',
      );
    }

    sourceOffer = {
      ...resolvedOffer,
      url: normalizedUrl,
      found: true,
      needsManualPick: false,
      searchCandidates: undefined,
      matchConfidence: resolvedOffer.matchConfidence ?? 100,
      matchStatus: 'verified',
    };
  }

  const title = hint?.title?.trim() || sourceOffer.title?.trim() || 'Товар';
  const modelInfo = inferProductModel(title, sourceOffer.specs);

  const marketplaceUrls: Partial<Record<ComparisonMarketplace, string>> = {
    [marketplace]: normalizedUrl,
  };

  const marketplaceOffers: Partial<Record<ComparisonMarketplace, MarketplaceOffer>> = {
    [marketplace]: sourceOffer,
  };

  const articlesByMarketplace: Partial<Record<ComparisonMarketplace, string>> = {};
  if (article) {
    articlesByMarketplace[marketplace] = article;
  }

  const base: CompareProduct = {
    id: `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    article,
    productModel: modelInfo.searchQuery.length >= 4 ? modelInfo.searchQuery : undefined,
    sourceUrl: normalizedUrl,
    sourceMarketplace: marketplace,
    marketplaceUrls,
    marketplaceOffers,
    articlesByMarketplace,
    sourceOffer,
    addedAt: Date.now(),
    authenticity: hint?.authenticity,
  };

  try {
    return await ensureCompareProductImage(base, { force: !base.sourceOffer?.imageUrl });
  } catch {
    return base;
  }
}

export async function resolveAndAddCompareProduct(
  url: string,
  articleOverride?: string,
  hint?: CompareProductHint,
): Promise<CompareProduct> {
  const incoming = await buildCompareProductFromUrl(url, articleOverride, hint);
  const products = await getCompareProducts();
  const duplicate = findDuplicateCompareProduct(products, incoming);

  if (duplicate) {
    const merged = mergeCompareProducts(duplicate, incoming);
    await saveCompareProducts([merged, ...products.filter((p) => p.id !== duplicate.id)]);
    return merged;
  }

  const { allowed, limit } = await canAddCompareProduct();
  if (!allowed) {
    throw new Error(`Лимит бесплатной версии: ${limit} товаров в «Мои товары». Оформите Premium.`);
  }
  await saveCompareProducts([incoming, ...products]);
  return incoming;
}

/** Привязать ссылку на площадку вручную (когда автопоиск не нашёл товар) */
export async function linkMarketplaceOffer(
  productId: string,
  marketplace: ComparisonMarketplace,
  url: string,
  options?: { confirmed?: boolean },
): Promise<CompareProduct> {
  const trimmedUrl = resolveCompareCandidateUrl(url, marketplace).trim();
  const detected = detectComparisonMarketplace(trimmedUrl);

  if (!detected) {
    throw new Error('Некорректная ссылка');
  }

  if (detected !== marketplace) {
    throw new Error(`Ссылка должна вести на ${COMPARISON_MARKETPLACE_LABELS[marketplace]}`);
  }

  const products = await getCompareProducts();
  const product = products.find((p) => p.id === productId);
  if (!product) {
    throw new Error('Товар не найден в списке сравнения');
  }

  const normalizedUrl = normalizeCompareUrl(trimmedUrl);

  const offer = await resolveOfferForUrl(normalizedUrl, marketplace);

  if (!offer || !isOfferWithPrice(offer)) {
    const errMsg =
      offer?.error === 'Нет в наличии'
        ? 'Товар недоступен / нет в наличии по этой ссылке'
        : 'Не удалось загрузить данные с этой карточки';
    throw new Error(errMsg);
  }

  const referenceTitle = getBestTitle(product);
  const fetchedTitle = offer.title?.trim() || 'Товар';
  const existing = product.marketplaceOffers?.[marketplace];
  const replacingPriced = isOfferWithPrice(existing);
  const confidence = computeMatchConfidence(
    referenceTitle,
    fetchedTitle,
    product.sourceOffer?.specs ?? existing?.specs,
  );
  const brandsOk = areBrandsCompatible(referenceTitle, fetchedTitle);
  const needsConfirm =
    !options?.confirmed &&
    (replacingPriced ||
      !brandsOk ||
      confidence < MANUAL_LINK_CONFIRM_CONFIDENCE);

  if (needsConfirm && referenceTitle !== 'Товар') {
    throw new ManualLinkNeedsConfirmError(referenceTitle, fetchedTitle, confidence);
  }

  const article = extractComparisonArticle(normalizedUrl, marketplace) || undefined;
  const oldArticle =
    product.articlesByMarketplace?.[marketplace] ||
    (existing?.url
      ? extractComparisonArticle(existing.url, marketplace) || undefined
      : undefined);
  if (oldArticle && article && oldArticle !== article) {
    const oldKey = stableProductStorageId({
      marketplace: marketplace as Marketplace,
      article: oldArticle,
      url: existing?.url,
    });
    if (oldKey) void clearPriceHistory(oldKey);
  }

  const cleaned: MarketplaceOffer = {
    ...offer,
    found: true,
    url: normalizedUrl,
    needsManualPick: false,
    searchCandidates: undefined,
    error: undefined,
    matchConfidence: confidence,
    matchStatus:
      confidence < MANUAL_LINK_CONFIRM_CONFIDENCE ? 'unverified_manual' : 'verified',
  };
  const updated = applyOffersToCompareProduct(product, [cleaned]);

  const withUrl: CompareProduct = {
    ...updated,
    marketplaceUrls: { ...updated.marketplaceUrls, [marketplace]: normalizedUrl },
    articlesByMarketplace: article
      ? { ...updated.articlesByMarketplace, [marketplace]: article }
      : updated.articlesByMarketplace,
    manualMarketplaces: { ...product.manualMarketplaces, [marketplace]: true },
    title: product.title === 'Товар' && offer.title ? offer.title : product.title,
    comparedAt: Date.now(),
  };

  await saveCompareProducts([withUrl, ...products.filter((p) => p.id !== productId)]);

  // X1: manual link is a strong cross-market signal
  if (marketplace !== product.sourceMarketplace) {
    void rememberPickHistory({
      referenceTitle,
      marketplace,
      url: normalizedUrl,
      title: fetchedTitle,
    });
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

  return withUrl;
}
