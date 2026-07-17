/**
 * Выбор кандидата из топ-3 SERP после низкого confidence.
 */
import { applyOffersToCompareProduct, isOfferWithPrice } from '@/lib/compare-offers';
import { enrichOfferRatingIfMissing, resolveOfferForUrl } from '@/lib/marketplace-search';
import { computeMatchConfidence } from '@/lib/product-match';
import { rememberCrossMarketMapping, resolveSourceProductId } from '@/lib/cross-market-map';
import { recordMatchFeedback } from '@/lib/match-feedback';
import { getCompareProducts, saveCompareProducts } from '@/lib/comparison-storage';
import { getBestTitle } from '@/lib/compare-merge';
import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import {
  detectComparisonMarketplace,
  extractComparisonArticle,
  normalizeCompareUrl,
} from '@/utils/comparison-url';

export async function selectCompareSearchCandidate(
  productId: string,
  marketplace: ComparisonMarketplace,
  candidateUrl: string,
): Promise<CompareProduct> {
  const trimmedUrl = candidateUrl.trim();
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
  let offer = await resolveOfferForUrl(normalizedUrl, marketplace);

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
    matchStatus: 'verified',
    needsManualPick: false,
    searchCandidates: undefined,
    error: undefined,
  };

  offer = await enrichOfferRatingIfMissing(offer);

  const article = extractComparisonArticle(normalizedUrl, marketplace) || undefined;
  const updated = applyOffersToCompareProduct(product, [offer]);

  const withMeta: CompareProduct = {
    ...updated,
    marketplaceUrls: { ...updated.marketplaceUrls, [marketplace]: normalizedUrl },
    articlesByMarketplace: article
      ? { ...updated.articlesByMarketplace, [marketplace]: article }
      : updated.articlesByMarketplace,
    // Фиксируем выбор пользователя — при refresh не запускаем поиск заново
    manualMarketplaces: { ...updated.manualMarketplaces, [marketplace]: true },
    comparedAt: Date.now(),
  };

  await saveCompareProducts([withMeta, ...products.filter((p) => p.id !== productId)]);

  // Ручной выбор — самый надёжный сигнал для глобального кэша и обучения
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
