import { detectAuthenticityFromDom } from '@/lib/authenticity/detect-dom';
import { parseRatingFromMarketplaceText, normalizeMarketplaceRating } from '@/lib/compare-offers';
import { extractProductFeatures } from '@/lib/product-features';
import { offerPricesFromYandexDomText } from '@/lib/yandex-offer';
import {
  canonicalUrl,
  getImageFromSelectors,
  getJsonLdProducts,
  getMetaContent,
  getTextFromSelectors,
  parsePrice,
  queryFirst,
} from '@/utils/dom';
import { extractArticle, isProductPage } from '@/utils/marketplace';
import type { Product } from '@/types/product';



const TITLE_SELECTORS = [

  'h1[data-auto="productCardTitle"]',

  'h1[data-additional-zone="title"]',

  'h1',

  '[data-zone-name="productTitle"]',

];



const PRICE_SELECTORS = [
  '[data-auto="price"]',
  '[data-auto="snippet-price-current"]',
  '[data-zone-name="price"]',
  '[data-auto="product-price"]',
  '[class*="price"]',
];



const RATING_SELECTORS = [

  '[data-auto="rating-badge"]',

  '[data-zone-name="rating"]',

  '[class*="rating"]',

];



const SPECS_SELECTORS = [

  '[data-auto="specs-list"] li',

  '[data-zone-name="specs"] li',

  'dl dt, dl dd',

];



const IMAGE_SELECTORS = [

  'meta[property="og:image"]',

  'meta[name="twitter:image"]',

  '[data-auto="gallery"] img',

  '[data-zone-name="picture"] img',

  '[data-auto="product-image"] img',

  '[data-zone-name="productImage"] img',

  '[class*="Gallery"] img',

  '[class*="gallery"] img',

  'img[src*="get-mpic"]',

  'img[src*="avatars.mds.yandex"]',

  'img[src*="market.yandex"]',

  '[itemprop="image"]',

];



function parseRubPrices(text: string): number[] {

  return [...text.replace(/\u00a0/g, ' ').matchAll(/(\d[\d\s]*)\s*₽/g)]

    .map((m) => parsePrice(m[1]))

    .filter((n) => n >= 50);

}



function extractImageUrl(): string | undefined {

  const fromSelectors = getImageFromSelectors(IMAGE_SELECTORS);

  if (fromSelectors) return fromSelectors;



  for (const jsonProduct of getJsonLdProducts()) {

    const image = jsonProduct.image;

    if (typeof image === 'string' && image.startsWith('http')) return image;

    if (Array.isArray(image) && typeof image[0] === 'string') return image[0];

    if (image && typeof image === 'object' && 'url' in image) {

      const url = (image as { url?: string }).url;

      if (url?.startsWith('http')) return url;

    }

  }



  const ogImage = getMetaContent(['og:image', 'twitter:image']);

  if (ogImage?.startsWith('http')) return ogImage;



  return undefined;

}



function extractRating(): { rating: number | null; reviewCount?: number } {
  const block = queryFirst(RATING_SELECTORS);
  const text = block?.textContent ?? document.body.textContent ?? '';
  return parseRatingFromMarketplaceText(text);
}



function extractSpecs(): string | undefined {

  const items = document.querySelectorAll(SPECS_SELECTORS.join(', '));

  const parts: string[] = [];



  for (const item of items) {

    const text = item.textContent?.trim();

    if (text && text.length > 2 && text.length < 80) {

      parts.push(text);

    }

    if (parts.length >= 4) break;

  }



  return parts.length ? parts.join(' · ') : undefined;

}



export function parseYandexMarketProduct(): Product | null {

  if (!isProductPage()) return null;

  if (!/market\.yandex\.ru/i.test(window.location.href)) return null;



  const url = canonicalUrl();
  const article = extractArticle(url, 'yandex_market');
  if (!article) return null;

  const title = getTextFromSelectors(TITLE_SELECTORS);

  if (!title) return null;



  const titleBlock = queryFirst(TITLE_SELECTORS);

  const priceRoot =

    titleBlock?.closest('[data-zone-name="product"], [data-auto="productCard"], main') ??

    titleBlock?.parentElement ??

    document.body;



  const priceBlock = queryFirst(PRICE_SELECTORS, priceRoot);

  const priceText = priceBlock?.textContent ?? priceRoot.textContent ?? '';
  const fromYm = offerPricesFromYandexDomText(priceText);
  const fallbackPrices = parseRubPrices(priceText);
  // Не брать Math.min — на ЯМ это часто цена «Пэй»
  const price = fromYm?.price ?? (fallbackPrices.length ? Math.max(...fallbackPrices) : 0);

  if (!price) return null;

  const imageUrl = extractImageUrl();
  const authenticity = detectAuthenticityFromDom('yandex_market');
  const { rating, reviewCount } = extractRating();
  const color = extractProductFeatures(title.slice(0, 300)).color;

  return {
    id: `yandex-${article}`,
    marketplace: 'yandex_market',
    title: title.slice(0, 300),
    price,
    basePrice: fromYm?.basePrice,
    payPrice: fromYm?.payPrice,
    oldPrice: fromYm?.oldPrice,
    currency: '₽',
    article,
    url,
    imageUrl,
    authenticity,
    scrapedAt: Date.now(),
    rating: normalizeMarketplaceRating(rating),
    reviewCount: reviewCount && reviewCount > 0 ? reviewCount : undefined,
    color: color ? String(color) : undefined,
  };
}



export function scrapeYandexMarketSpecs(): { rating: number | null; reviewCount?: number; specs?: string } {

  const { rating, reviewCount } = extractRating();

  const specs = extractSpecs();

  return { rating, reviewCount, specs };

}


