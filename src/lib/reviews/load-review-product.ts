/**
 * Загрузка Product для вкладки «Отзывы» по ссылке или артикулу WB.
 */

import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import {
  classifyReviewInput,
  resolveReviewTarget,
  type ResolvedReviewTarget,
} from '@/lib/reviews/resolve-target';
import type { ComparisonMarketplace } from '@/types/comparison';
import type { Marketplace, Product } from '@/types/product';
import { extractArticle } from '@/utils/marketplace';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { buildWbImageUrlAlternatives } from '@/utils/wb-image';

function productIdFor(marketplace: Marketplace, article: string): string {
  const prefix =
    marketplace === 'wildberries' ? 'wb' : marketplace === 'ozon' ? 'ozon' : 'ym';
  return article ? `${prefix}-${article}` : `review_${marketplace}_${Date.now()}`;
}

function productFromTarget(
  target: ResolvedReviewTarget,
  overrides: Partial<Product> = {},
): Product {
  const article =
    overrides.article ??
    target.article ??
    extractArticle(target.productUrl, target.marketplace) ??
    '';
  const url = toCanonicalProductUrl(target.productUrl, target.marketplace);

  return {
    id: overrides.id ?? productIdFor(target.marketplace, article),
    marketplace: target.marketplace,
    title: overrides.title ?? target.productTitle,
    price: overrides.price ?? 0,
    oldPrice: overrides.oldPrice,
    currency: '₽',
    article,
    url,
    imageUrl: overrides.imageUrl,
    imageUrlAlternatives: overrides.imageUrlAlternatives,
    scrapedAt: Date.now(),
  };
}

async function loadWildberriesProduct(target: ResolvedReviewTarget): Promise<Product> {
  const article =
    target.article || extractArticle(target.productUrl, 'wildberries') || '';
  if (!article) {
    throw new Error('Не удалось определить артикул Wildberries');
  }

  const api = await fetchWildberriesProduct(article);
  if (api?.title) {
    return productFromTarget(target, {
      id: `wb-${article}`,
      title: api.title,
      price: api.price ?? 0,
      oldPrice: api.oldPrice,
      article,
      imageUrl: api.imageUrl,
      imageUrlAlternatives: api.imageUrlAlternatives ?? buildWbImageUrlAlternatives(article),
    });
  }

  // Для отзывов достаточно URL + артикула, даже без цены
  return productFromTarget(target, {
    id: `wb-${article}`,
    article,
    title: target.productTitle || `Товар WB ${article}`,
  });
}

async function loadOfferProduct(target: ResolvedReviewTarget): Promise<Product> {
  const mp = target.marketplace as ComparisonMarketplace;
  const offer = await fetchOfferFromUrl(target.productUrl, mp);
  const article =
    target.article || extractArticle(target.productUrl, target.marketplace) || '';

  if (offer?.title) {
    return productFromTarget(target, {
      title: offer.title,
      price: offer.price ?? 0,
      oldPrice: offer.oldPrice,
      article,
      imageUrl: offer.imageUrl,
    });
  }

  if (!article && !target.productUrl) {
    throw new Error('Не удалось загрузить карточку по ссылке');
  }

  return productFromTarget(target, {
    article,
    title: target.productTitle || 'Товар',
  });
}

/** Резолв ввода + загрузка Product (без SERP по модели). */
export async function loadReviewProductFromInput(input: string): Promise<Product> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Вставьте ссылку на карточку или артикул Wildberries');
  }

  const kind = classifyReviewInput(trimmed);
  if (kind === 'model') {
    throw new Error(
      'Вставьте ссылку на карточку или артикул Wildberries',
    );
  }

  const target = await resolveReviewTarget(trimmed);

  if (target.marketplace === 'wildberries') {
    return loadWildberriesProduct(target);
  }

  return loadOfferProduct(target);
}
