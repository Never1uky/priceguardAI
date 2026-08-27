import { detectAuthenticityFromDom } from '@/lib/authenticity/detect-dom';
import { normalizeMarketplaceRating, parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { extractProductFeatures } from '@/lib/product-features';
import { ozonBreakdownToOfferPrices, parseOzonPriceBlockText } from '@/lib/ozon-prices';
import type { Product } from '@/types/product';
import {
  canonicalUrl,
  cleanTitle,
  extractPriceFromJsonLd,
  getImageFromSelectors,
  getJsonLdProducts,
  getMetaContent,
  getTextFromSelectors,
  parsePrice,
  queryFirst,
} from '@/utils/dom';
import { extractBaseDiscountPrice } from '@/utils/price-filter';
import { detectMarketplace, extractArticle, isProductPage } from '@/utils/marketplace';

const TITLE_SELECTORS = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  '[data-widget="webProductHeading"] h1',
  'h1[class*="tsHeadline"]',
  'h1[class*="title"]',
  '[itemprop="name"]',
  'h1',
];

const CURRENT_PRICE_SELECTORS = [
  '[data-widget="webPrice"] [class*="tsHeadline500Medium"]',
  '[data-widget="webPrice"] span[class*="tsHeadline"]:not([class*="card"])',
  '[data-widget="webPrice"] span[class*="price"]',
  '[class*="Price_price"]:not([class*="card"])',
  '[itemprop="price"]',
];

const OLD_PRICE_SELECTORS = [
  '[data-widget="webPrice"] span[class*="original"]',
  '[data-widget="webPrice"] span[class*="tsBodyControl"]',
  '[data-widget="webPrice"] del',
  '[data-widget="webPrice"] s',
  '[class*="Price_old"]',
  '[class*="price-old"]',
  '[class*="oldPrice"]',
  'del',
  's',
];

const IMAGE_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
  '[data-widget="webGallery"] img',
  '[class*="gallery"] img',
  '[itemprop="image"]',
  'img[src*="ozone"]',
  'img[src*="ozonusercontent"]',
];

const PRICE_BLOCK_SELECTORS = [
  '[data-widget="webPrice"]',
  '[data-widget="webSale"]',
  '[class*="Price"]',
  '[class*="price"]',
  'main',
];

function extractTitle(): string | undefined {
  const ogTitle = getMetaContent(['og:title', 'twitter:title']);
  if (ogTitle) return cleanTitle(ogTitle, 'ozon');

  const h1Text = getTextFromSelectors(TITLE_SELECTORS.filter((s) => !s.startsWith('meta')));
  if (h1Text) return cleanTitle(h1Text);

  return undefined;
}

function extractPrices(): {
  price?: number;
  oldPrice?: number;
  basePrice?: number;
  payPrice?: number;
} {
  const priceBlock = queryFirst(PRICE_BLOCK_SELECTORS);

  if (priceBlock) {
    const dual = parseOzonPriceBlockText(
      (priceBlock as HTMLElement).innerText || priceBlock.textContent || '',
    );
    if (dual?.price) {
      return ozonBreakdownToOfferPrices(dual);
    }

    const fromBlock = extractBaseDiscountPrice(priceBlock);
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
    return {
      price,
      basePrice: price,
      oldPrice: oldPrice > price ? oldPrice : undefined,
    };
  }

  const metaPrice = getMetaContent(['product:price:amount', 'og:price:amount']);
  const metaParsed = parsePrice(metaPrice);
  if (metaParsed > 0) return { price: metaParsed, basePrice: metaParsed };

  return {};
}

export function parseOzonProduct(): Product | null {
  if (!isProductPage()) return null;

  const url = canonicalUrl();
  const article = extractArticle(url, 'ozon');
  if (!article) return null;

  const title = extractTitle();
  const { price, oldPrice, basePrice, payPrice } = extractPrices();
  const imageUrl = getImageFromSelectors(IMAGE_SELECTORS);

  if (!title || !price) return null;

  const authenticity = detectAuthenticityFromDom('ozon');
  const { rating, reviewCount } = parseRatingFromMarketplaceText(
    document.body?.textContent ?? '',
  );
  const color = extractProductFeatures(cleanTitle(title, 'ozon')).color;

  return {
    id: `ozon-${article}`,
    marketplace: 'ozon',
    title: cleanTitle(title, 'ozon'),
    price,
    oldPrice,
    basePrice,
    payPrice,
    currency: '₽',
    article,
    url,
    imageUrl,
    scrapedAt: Date.now(),
    authenticity,
    rating: normalizeMarketplaceRating(rating),
    reviewCount: reviewCount && reviewCount > 0 ? reviewCount : undefined,
    color: color ? String(color) : undefined,
  };
}

export function scrapeOzon(): Product | null {
  if (detectMarketplace(window.location.href) !== 'ozon') return null;
  return parseOzonProduct();
}
