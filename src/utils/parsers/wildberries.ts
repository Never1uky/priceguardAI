import type { Product } from '@/types/product';
import type { ProductAuthenticity } from '@/types/authenticity';
import { detectAuthenticityFromDom } from '@/lib/authenticity/detect-dom';
import {
  canonicalUrl,
  extractPriceFromJsonLd,
  getImageFromSelectors,
  getJsonLdProducts,
  getMetaContent,
  getTextFromSelectors,
  parsePrice,
  queryFirst,
} from '@/utils/dom';
import { extractWbPriceWithoutWallet } from '@/utils/price-filter';
import { extractArticle, isProductPage } from '@/utils/marketplace';
import {
  fetchWildberriesProduct,
  parseWildberriesEmbeddedState,
} from '@/utils/parsers/wb-api';
import { buildWbImageUrl, buildWbImageUrlAlternatives, isGenericWildberriesTitle } from '@/utils/wb-image';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { buildOutOfStockProduct, isProductOutOfStock } from '@/lib/product-availability';
import { normalizeMarketplaceRating, parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { extractProductFeatures } from '@/lib/product-features';

const TITLE_SELECTORS = [
  'h1[class*="productTitle"]',
  'h1[class*="ProductTitle"]',
  'h1[class*="product-page"]',
  '[class*="productTitle"]',
  '[class*="product-page__header"] h1',
  '[class*="product-page__title"]',
  '[data-link="text{:productCardName}"]',
  'h1[class*="title"]',
  '[itemprop="name"]',
  'h1',
];

const CURRENT_PRICE_SELECTORS = [
  'ins[class*="priceBlockFinalPrice"]',
  '[class*="priceBlockFinalPrice"]',
  '[class*="price-block__final-price"]',
  '.price-block__final-price',
  '[class*="final-price"]',
  '[class*="productPrice"]',
  '[itemprop="price"]',
];

const OLD_PRICE_SELECTORS = [
  '[class*="priceBlockOldPrice"]',
  '[class*="price-block__old-price"]',
  '.price-block__old-price',
  '[class*="oldPrice"]',
  'del[class*="price"]',
  's[class*="price"]',
];

const IMAGE_SELECTORS = [
  '[class*="slideContainer"] img[src*="wbbasket"]',
  '[class*="slideContainer"] img[src*="wbcontent"]',
  '[class*="mainSlider"] img',
  '[class*="photo"] img[src*="wbbasket"]',
  '[class*="gallery"] img[src*="wbbasket"]',
  'img[src*="wbbasket"]',
  'img[src*="wbcontent"]',
  'img[src*="geobasket"]',
];

const PRICE_BLOCK_SELECTORS = [
  '[class*="priceBlock"]',
  '[class*="price-block"]',
  '[class*="productSummary"]',
  '[class*="product-page__aside"]',
];

function extractTitleFromDom(): string | undefined {
  const h1Text = getTextFromSelectors(TITLE_SELECTORS);
  if (h1Text && !isGenericWildberriesTitle(h1Text)) {
    return h1Text.trim();
  }

  const embedded = parseWildberriesEmbeddedState();
  if (embedded?.title) return embedded.title;

  const ogTitle = getMetaContent(['og:title', 'twitter:title']);
  if (ogTitle && !isGenericWildberriesTitle(ogTitle)) {
    return ogTitle.trim();
  }

  return h1Text?.trim();
}

function extractPricesFromDom(): { price?: number; oldPrice?: number } {
  const priceBlock = queryFirst(PRICE_BLOCK_SELECTORS);

  if (priceBlock) {
    const fromBlock = extractWbPriceWithoutWallet(priceBlock);
    if (fromBlock.price) return fromBlock;
  }

  for (const jsonProduct of getJsonLdProducts()) {
    const fromJson = extractPriceFromJsonLd(jsonProduct);
    if (fromJson.price) return fromJson;
  }

  const currentText = getTextFromSelectors(CURRENT_PRICE_SELECTORS);
  const oldText = getTextFromSelectors(OLD_PRICE_SELECTORS);
  const price = parsePrice(currentText);
  const oldPrice = parsePrice(oldText);

  if (price > 0) {
    return { price, oldPrice: oldPrice > price ? oldPrice : undefined };
  }

  const embedded = parseWildberriesEmbeddedState();
  if (embedded?.price) {
    return { price: embedded.price, oldPrice: embedded.oldPrice };
  }

  return {};
}

function resolveImage(article: string, domImage?: string, apiResult?: { imageUrl: string; imageUrlAlternatives?: string[] }): string | undefined {
  if (apiResult?.imageUrl) return apiResult.imageUrl;
  if (domImage && (domImage.includes('wbbasket') || domImage.includes('wbcontent'))) {
    return domImage;
  }
  return buildWbImageUrl(article);
}

function cardMetaFromPage(title: string, api?: { reviewRating?: number; feedbacks?: number } | null): {
  rating?: number | null;
  reviewCount?: number;
  color?: string;
} {
  const domRating = parseRatingFromMarketplaceText(document.body?.textContent ?? '');
  const rating = normalizeMarketplaceRating(api?.reviewRating ?? domRating.rating);
  const reviewCount =
    (api?.feedbacks && api.feedbacks > 0 ? api.feedbacks : undefined) ??
    (domRating.reviewCount && domRating.reviewCount > 0 ? domRating.reviewCount : undefined);
  const color = extractProductFeatures(title).color;
  return {
    rating,
    reviewCount,
    color: color ? String(color) : undefined,
  };
}

function buildProduct(
  article: string,
  data: {
    title: string;
    price: number;
    oldPrice?: number;
    imageUrl?: string;
    imageUrlAlternatives?: string[];
    outOfStock?: boolean;
    rating?: number | null;
    reviewCount?: number;
    color?: string;
  },
): Product {
  const authenticity: ProductAuthenticity = detectAuthenticityFromDom('wildberries');
  const url = toCanonicalProductUrl(canonicalUrl(), 'wildberries');

  if (data.outOfStock || !(data.price > 0)) {
    return {
      ...buildOutOfStockProduct({
        marketplace: 'wildberries',
        title: data.title,
        article,
        url,
        imageUrl: data.imageUrl,
        imageUrlAlternatives: data.imageUrlAlternatives,
        oldPrice: data.oldPrice,
        authenticity,
      }),
      rating: data.rating,
      reviewCount: data.reviewCount,
      color: data.color,
    };
  }

  return {
    id: `wb-${article}`,
    marketplace: 'wildberries',
    title: data.title,
    price: data.price,
    oldPrice: data.oldPrice,
    currency: '₽',
    article,
    url,
    imageUrl: data.imageUrl,
    imageUrlAlternatives: data.imageUrlAlternatives,
    scrapedAt: Date.now(),
    authenticity,
    availability: 'in_stock',
    rating: data.rating,
    reviewCount: data.reviewCount,
    color: data.color,
  };
}

export function parseWildberriesProductFromDom(): Product | null {
  if (!isProductPage()) return null;

  const article = extractArticle(canonicalUrl(), 'wildberries');
  if (!article) return null;

  const title = extractTitleFromDom();
  const { price, oldPrice } = extractPricesFromDom();
  const domImage = getImageFromSelectors(IMAGE_SELECTORS);

  if (!title || isGenericWildberriesTitle(title)) return null;

  if (!price) {
    return buildProduct(article, {
      title,
      price: 0,
      oldPrice,
      imageUrl: resolveImage(article, domImage),
      imageUrlAlternatives: buildWbImageUrlAlternatives(article),
      outOfStock: true,
    });
  }

  return buildProduct(article, {
    title,
    price,
    oldPrice,
    imageUrl: resolveImage(article, domImage),
    imageUrlAlternatives: buildWbImageUrlAlternatives(article),
  });
}

export async function parseWildberriesProduct(): Promise<Product | null> {
  if (!isProductPage()) return null;

  const article = extractArticle(canonicalUrl(), 'wildberries');
  if (!article) return null;

  const [fromApi, fromDom] = await Promise.all([
    fetchWildberriesProduct(article),
    Promise.resolve(parseWildberriesProductFromDom()),
  ]);

  const prices = fromDom
    ? { price: fromDom.price, oldPrice: fromDom.oldPrice, outOfStock: isProductOutOfStock(fromDom) }
    : {
        price: fromApi?.price ?? 0,
        oldPrice: fromApi?.oldPrice,
        outOfStock: Boolean(fromApi?.outOfStock),
      };

  const title =
    (fromApi?.title && !isGenericWildberriesTitle(fromApi.title) ? fromApi.title : null) ??
    (fromDom?.title && !isGenericWildberriesTitle(fromDom.title) ? fromDom.title : null);

  if (!title) return null;

  const meta = cardMetaFromPage(title, fromApi);

  const domImage = getImageFromSelectors(IMAGE_SELECTORS);

  if (!prices.price || prices.outOfStock) {
    return buildProduct(article, {
      title,
      price: 0,
      oldPrice: prices.oldPrice,
      imageUrl: resolveImage(article, domImage, fromApi ?? undefined),
      imageUrlAlternatives:
        fromApi?.imageUrlAlternatives ?? buildWbImageUrlAlternatives(article),
      outOfStock: true,
      ...meta,
    });
  }

  return buildProduct(article, {
    title,
    price: prices.price,
    oldPrice: prices.oldPrice,
    imageUrl: resolveImage(article, domImage, fromApi ?? undefined),
    imageUrlAlternatives:
      fromApi?.imageUrlAlternatives ?? buildWbImageUrlAlternatives(article),
    ...meta,
  });
}
