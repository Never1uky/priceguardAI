import { findDuplicateCompareProduct, mergeCompareProducts } from '@/lib/compare-merge';
import { canAddCompareProduct } from '@/lib/subscription';
import { getCompareProducts, saveCompareProducts } from '@/lib/comparison-storage';
import { applyOffersToCompareProduct, isOfferWithPrice } from '@/lib/compare-offers';
import { resolveOfferForUrl } from '@/lib/marketplace-search';
import { inferProductModel } from '@/lib/model-extract';
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
} from '@/utils/comparison-url';

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

  return base;
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

  const { allowed, limit } = await canAddCompareProduct(products.length);
  if (!allowed) {
    throw new Error(`Лимит бесплатной версии: ${limit} товаров в сравнении. Оформите Premium.`);
  }
  await saveCompareProducts([incoming, ...products]);
  return incoming;
}

/** Привязать ссылку на площадку вручную (когда автопоиск не нашёл товар) */
export async function linkMarketplaceOffer(
  productId: string,
  marketplace: ComparisonMarketplace,
  url: string,
): Promise<CompareProduct> {
  const trimmedUrl = url.trim();
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
    throw new Error('Не удалось загрузить данные с этой карточки');
  }

  const article = extractComparisonArticle(normalizedUrl, marketplace) || undefined;
  const cleaned: MarketplaceOffer = {
    ...offer,
    found: true,
    url: normalizedUrl,
    needsManualPick: false,
    searchCandidates: undefined,
    error: undefined,
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
  return withUrl;
}
