import { parsePrice } from '@/utils/dom';
import {
  buildWbImageUrl,
  buildWbImageUrlAlternatives,
  isGenericWildberriesTitle,
} from '@/utils/wb-image';
import {
  parseWbFeedbacksPayload,
  type WbReviewItem,
} from '@/lib/reviews/wb-feedbacks';

export type { WbReviewItem } from '@/lib/reviews/wb-feedbacks';

interface WbV4Size {
  price?: { basic?: number; product?: number; logistics?: number };
  time1?: number;
  time2?: number;
}

interface WbApiProduct {
  id?: number;
  nmId?: number;
  root?: number;
  imt_id?: number;
  name?: string;
  imt_name?: string;
  brand?: string;
  salePriceU?: number;
  priceU?: number;
  basicPriceU?: number;
  sale?: number;
  pics?: number;
  reviewRating?: number;
  nmReviewRating?: number;
  feedbacks?: number;
  nmFeedbacks?: number;
  sizes?: WbV4Size[];
  extended?: {
    basicPriceU?: number;
    clientSalePrice?: number;
  };
}

interface WbApiResponse {
  data?: { products?: WbApiProduct[] };
  products?: WbApiProduct[];
}

const WB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const WB_FETCH_HEADERS: HeadersInit = {
  Accept: 'application/json',
  'User-Agent': WB_USER_AGENT,
};

function isDomEnvironment(): boolean {
  return typeof document !== 'undefined';
}

function normalizeKopecks(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  if (value >= 1000) return Math.round(value / 100);
  return value;
}

function pickApiPrices(product: WbApiProduct): { price: number; oldPrice?: number } {
  const size = product.sizes?.[0];
  if (size?.price?.product || size?.price?.basic) {
    const salePrice = normalizeKopecks(size.price.product);
    const basicPrice = normalizeKopecks(size.price.basic);
    const price = salePrice || basicPrice;
    const oldPrice = basicPrice > price ? basicPrice : undefined;
    if (price) return { price, oldPrice };
  }

  const salePrice = normalizeKopecks(
    product.salePriceU ?? product.extended?.clientSalePrice ?? product.sale,
  );
  const basicPrice = normalizeKopecks(
    product.priceU ?? product.basicPriceU ?? product.extended?.basicPriceU,
  );

  const price = salePrice || basicPrice;
  const oldPrice = basicPrice > price ? basicPrice : undefined;

  return { price, oldPrice };
}

function pickWbDelivery(product: WbApiProduct): string | null {
  const size = product.sizes?.[0];
  const time1 = size?.time1;
  const time2 = size?.time2;
  if (!time1 || !time2) return null;
  return time1 === time2 ? `${time1} дн.` : `${time1}–${time2} дн.`;
}

function buildTitle(product: WbApiProduct): string {
  const brand = product.brand?.trim() ?? '';
  const name = (product.name ?? product.imt_name ?? '').trim();
  if (brand && name && !name.toLowerCase().startsWith(brand.toLowerCase())) {
    return `${brand} ${name}`;
  }
  return name || brand;
}

export interface WbApiResult {
  title: string;
  price: number;
  oldPrice?: number;
  imageUrl: string;
  imageUrlAlternatives: string[];
  reviewRating?: number;
  feedbacks?: number;
  delivery?: string | null;
}

export async function fetchWildberriesProduct(nmId: string): Promise<WbApiResult | null> {
  const endpoints = [
    `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
    `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
    `https://card.wb.ru/cards/v1/detail?nm=${nmId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: WB_FETCH_HEADERS });
      if (!response.ok) continue;

      const data = (await response.json()) as WbApiResponse;
      const product = data?.data?.products?.[0] ?? data?.products?.[0];
      if (!product) continue;

      const title = buildTitle(product);
      const { price, oldPrice } = pickApiPrices(product);

      if (!title || !price || isGenericWildberriesTitle(title)) continue;

      const id = String(product.nmId ?? product.id ?? nmId);

      return {
        title,
        price,
        oldPrice,
        imageUrl: buildWbImageUrl(id),
        imageUrlAlternatives: buildWbImageUrlAlternatives(id),
        reviewRating: product.reviewRating ?? product.nmReviewRating,
        feedbacks: product.feedbacks ?? product.nmFeedbacks,
        delivery: pickWbDelivery(product),
      };
    } catch {
      // следующий endpoint
    }
  }

  return null;
}

export function parseWildberriesEmbeddedState(): WbApiResult | null {
  if (!isDomEnvironment()) return null;

  const html = document.documentElement.innerHTML;

  const nameMatch = html.match(/"imt_name"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const brandMatch = html.match(/"brand"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const saleMatch = html.match(/"salePriceU"\s*:\s*(\d+)/);
  const priceMatch = html.match(/"priceU"\s*:\s*(\d+)/);

  const decode = (s?: string) =>
    s?.replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16))) ?? '';

  const title = [decode(brandMatch?.[1]), decode(nameMatch?.[1])].filter(Boolean).join(' ').trim();
  const salePrice = normalizeKopecks(parsePrice(saleMatch?.[1]));
  const basicPrice = normalizeKopecks(parsePrice(priceMatch?.[1]));
  const price = salePrice || basicPrice;

  if (!title || !price || isGenericWildberriesTitle(title)) return null;

  const articleMatch = window.location.href.match(/\/catalog\/(\d+)/i);
  const nmId = articleMatch?.[1] ?? '';

  return {
    title,
    price,
    oldPrice: basicPrice > price ? basicPrice : undefined,
    imageUrl: nmId ? buildWbImageUrl(nmId) : '',
    imageUrlAlternatives: nmId ? buildWbImageUrlAlternatives(nmId) : [],
  };
}

function extractRootFromHtml(html: string): string | null {
  const patterns = [
    /"root"\s*:\s*(\d+)/,
    /"imt_id"\s*:\s*(\d+)/,
    /"imtId"\s*:\s*(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/** root/imt_id из HTML карточки (service worker / background). */
export async function fetchWildberriesRootFromHtml(nmId: string): Promise<string | null> {
  const urls = [
    `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`,
    `https://www.wildberries.ru/catalog/${nmId}/feedbacks`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': WB_USER_AGENT,
        },
      });
      if (!response.ok) continue;

      const html = await response.text();
      const root = extractRootFromHtml(html);
      if (root) return root;
    } catch {
      // следующий URL
    }
  }

  return null;
}

export async function fetchWildberriesRoot(nmId: string): Promise<string | null> {
  const endpoints = [
    `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
    `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: WB_FETCH_HEADERS });
      if (!response.ok) continue;

      const data = (await response.json()) as WbApiResponse;
      const product = data?.data?.products?.[0] ?? data?.products?.[0];
      const root = product?.root ?? product?.imt_id;
      if (root) return String(root);
    } catch {
      // следующий endpoint
    }
  }

  const fromHtml = await fetchWildberriesRootFromHtml(nmId);
  if (fromHtml) return fromHtml;

  if (isDomEnvironment()) {
    return parseWildberriesRootFromDom();
  }

  return null;
}

export function parseWildberriesRootFromDom(): string | null {
  if (!isDomEnvironment()) return null;

  return extractRootFromHtml(document.documentElement.innerHTML);
}

async function fetchWbFeedbacksUrl(url: string, limit: number): Promise<WbReviewItem[]> {
  try {
    const response = await fetch(url, {
      headers: WB_FETCH_HEADERS,
      credentials: 'include',
    });
    if (!response.ok) return [];

    const data = await response.json();
    return parseWbFeedbacksPayload(data, limit);
  } catch {
    return [];
  }
}

export async function fetchWildberriesReviews(nmId: string, limit = 30): Promise<WbReviewItem[]> {
  const root = (await fetchWildberriesRoot(nmId)) ?? nmId;

  const endpoints = [
    `https://feedbacks1.wb.ru/feedbacks/v1/${nmId}?take=${limit}&skip=0&isAnswered=true`,
    `https://feedbacks2.wb.ru/feedbacks/v1/${nmId}?take=${limit}&skip=0&isAnswered=true`,
    `https://feedbacks1.wb.ru/feedbacks/v2/${nmId}?take=${limit}&skip=0`,
    `https://feedbacks2.wb.ru/feedbacks/v2/${nmId}?take=${limit}&skip=0`,
    `https://feedbacks1.wb.ru/feedbacks/v2/${root}?take=${limit}&skip=0`,
    `https://feedbacks2.wb.ru/feedbacks/v2/${root}?take=${limit}&skip=0`,
    `https://feedbacks1.wb.ru/feedbacks/v1/${root}?take=${limit}&skip=0&isAnswered=true`,
    `https://feedbacks2.wb.ru/feedbacks/v1/${root}?take=${limit}&skip=0&isAnswered=true`,
  ];

  for (const endpoint of endpoints) {
    const items = await fetchWbFeedbacksUrl(endpoint, limit);
    if (items.length > 0) return items;
  }

  return [];
}
