import type { MarketplaceOffer } from '@/types/comparison';
import { fetchWithRetry } from '@/lib/fetch-retry';
import {
  parseYandexPriceBlockText,
  yandexBreakdownToOfferPrices,
  type YandexPriceBreakdown,
} from '@/lib/yandex-prices';

interface YmProduct {
  titles?: { raw?: string };
  prices?: {
    value?: string | number;
    /** Иногда API отдаёт несколько представлений */
    current?: string | number;
    raw?: string | number;
    discountBase?: string | number;
  };
  /** Текстовые бейджи оплаты */
  paymentTypes?: string[];
  paymentMethod?: string;
  urls?: { direct?: string };
  rating?: number;
  preciseRating?: number;
  opinions?: number;
  specs?: Record<string, string>;
  fullSpecs?: Array<{ name?: string; value?: string }>;
  pictures?: Array<{ original?: { url?: string }; url?: string }>;
  photos?: Array<{ url?: string; link?: string }>;
  images?: Array<string | { url?: string }>;
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && raw > 0) return Math.round(raw);
  if (typeof raw === 'string') {
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    return n > 0 ? n : undefined;
  }
  return undefined;
}

function extractYmImageUrl(product: YmProduct): string | undefined {
  for (const pic of product.pictures ?? []) {
    const url = pic.original?.url ?? pic.url;
    if (url?.startsWith('http')) return url;
  }

  for (const photo of product.photos ?? []) {
    const url = photo.url ?? photo.link;
    if (url?.startsWith('http')) return url;
  }

  for (const img of product.images ?? []) {
    if (typeof img === 'string' && img.startsWith('http')) return img;
    if (img && typeof img === 'object' && img.url?.startsWith('http')) return img.url;
  }

  return undefined;
}

function walkImageUrls(node: unknown, results: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkImageUrls(item, results);
    return;
  }

  const obj = node as Record<string, unknown>;

  for (const key of ['original', 'url', 'src']) {
    const val = obj[key];
    if (typeof val === 'string' && val.startsWith('http') && /(get-mpic|yandex|avatars\.mds)/i.test(val)) {
      results.push(val);
    }
  }

  for (const value of Object.values(obj)) {
    walkImageUrls(value, results);
  }
}

function walkProducts(node: unknown, results: YmProduct[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkProducts(item, results);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (obj.titles && obj.prices) {
    results.push(obj as YmProduct);
  }

  for (const value of Object.values(obj)) {
    walkProducts(value, results);
  }
}

/** Собрать числа цен из вложенного JSON (price / value / amount) */
function walkPriceNumbers(node: unknown, out: number[], depth = 0): void {
  if (depth > 8 || !node) return;
  if (typeof node === 'number' && node >= 50 && node < 50_000_000) {
    out.push(Math.round(node));
    return;
  }
  if (typeof node === 'string') {
    const n = toNumber(node);
    if (n) out.push(n);
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkPriceNumbers(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (/price|amount|value|cost/i.test(key)) {
      walkPriceNumbers(value, out, depth + 1);
    } else if (typeof value === 'object') {
      walkPriceNumbers(value, out, depth + 1);
    }
  }
}

function extractSpecs(product: YmProduct): string | undefined {
  if (product.fullSpecs?.length) {
    return product.fullSpecs
      .slice(0, 4)
      .map((s) => `${s.name}: ${s.value}`)
      .join(' · ');
  }

  if (product.specs && typeof product.specs === 'object') {
    return Object.entries(product.specs)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  return undefined;
}

function isPayTagged(product: YmProduct): boolean {
  const blob = [
    product.paymentMethod,
    ...(product.paymentTypes ?? []),
  ]
    .filter(Boolean)
    .join(' ');
  return /п[еэ]й|pay/i.test(blob);
}

function breakdownFromYmProduct(product: YmProduct, rawNode?: unknown): YandexPriceBreakdown | null {
  const primary =
    toNumber(product.prices?.discountBase) ??
    toNumber(product.prices?.raw) ??
    toNumber(product.prices?.current) ??
    toNumber(product.prices?.value);

  const collected: number[] = [];
  if (rawNode) walkPriceNumbers(rawNode, collected);
  walkPriceNumbers(product.prices, collected);
  if (primary) collected.push(primary);

  const unique = [...new Set(collected.filter((n) => n >= 50))].sort((a, b) => a - b);
  if (!unique.length) return null;

  const min = unique[0]!;
  const max = unique[unique.length - 1]!;

  // Несколько уровней: max часто old/зачёркнутая, mid — base, min — pay
  if (unique.length >= 3 && max > min * 1.08) {
    const mid = unique[Math.floor(unique.length / 2)]!;
    const base = Math.max(mid, ...unique.filter((p) => p < max * 0.98));
    const pay = min < base * 0.98 ? min : undefined;
    return {
      price: base,
      basePrice: base,
      payPrice: pay,
      oldPrice: max > base * 1.02 ? max : undefined,
    };
  }

  if (unique.length === 2 && max / min >= 1.04 && max / min <= 1.4) {
    if (isPayTagged(product)) {
      return { price: max, basePrice: max, payPrice: min, oldPrice: undefined };
    }
    // Типичный Pay vs карта без тегов
    return { price: max, basePrice: max, payPrice: min };
  }

  if (isPayTagged(product) && primary) {
    return { price: primary, basePrice: primary, payPrice: primary };
  }

  const price = primary ?? min;
  return {
    price,
    basePrice: price,
    oldPrice: max > price * 1.05 ? max : undefined,
  };
}

function productToOffer(product: YmProduct, fallbackUrl: string, rawNode?: unknown): MarketplaceOffer | null {
  const breakdown = breakdownFromYmProduct(product, rawNode);
  if (!breakdown?.price) return null;

  const prices = yandexBreakdownToOfferPrices(breakdown);

  return {
    marketplace: 'yandex_market',
    title: product.titles?.raw ?? 'Товар на Яндекс.Маркет',
    price: prices.price,
    basePrice: prices.basePrice,
    payPrice: prices.payPrice,
    oldPrice: prices.oldPrice,
    delivery: null,
    rating: product.rating ?? product.preciseRating ?? null,
    reviewCount: product.opinions,
    specs: extractSpecs(product),
    imageUrl: extractYmImageUrl(product),
    url: product.urls?.direct ?? fallbackUrl,
    found: true,
  };
}

export async function fetchYandexOfferFromPage(url: string): Promise<MarketplaceOffer | null> {
  const path = new URL(url).pathname + new URL(url).search;

  const endpoints = [
    `https://market.yandex.ru/api/resolve/?r=${encodeURIComponent(path)}`,
    `https://market.yandex.ru/api/v1/search?text=${encodeURIComponent(path)}&cvredirect=1`,
  ];

  let fallbackImage: string | undefined;

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithRetry(endpoint, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;

      const data = await response.json();

      if (!fallbackImage) {
        const imageCandidates: string[] = [];
        walkImageUrls(data, imageCandidates);
        fallbackImage = imageCandidates[0];
      }

      const products: YmProduct[] = [];
      walkProducts(data, products);

      const offer = products.length ? productToOffer(products[0]!, url, products[0]) : null;
      if (offer) {
        return fallbackImage && !offer.imageUrl ? { ...offer, imageUrl: fallbackImage } : offer;
      }
    } catch {
      // следующий endpoint
    }
  }

  return null;
}

/** Для content-script / тестов: разобрать видимый текст цены */
export function offerPricesFromYandexDomText(text: string): ReturnType<typeof yandexBreakdownToOfferPrices> | null {
  const breakdown = parseYandexPriceBlockText(text);
  return breakdown ? yandexBreakdownToOfferPrices(breakdown) : null;
}
