/**
 * Megamarket (megamarket.ru / sbermegamarket.ru) product card scrape.
 * Prefer JSON-LD / embedded state; fall back to visible DOM.
 * Tab-tier only — no Scrappey.
 */
import type { Product } from '@/types/product';
import { extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { parsePrice } from '@/utils/dom';
import { parseListingRubNumbers } from '@/lib/listing-rub-prices';
import { extractProductFeatures } from '@/lib/product-features';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseRub(raw: string): number | null {
  const fromDom = parsePrice(raw);
  if (fromDom > 0) return fromDom;
  const nums = parseListingRubNumbers(raw);
  return nums[0] ?? null;
}

function brandFromLd(brand: unknown): string | undefined {
  if (typeof brand === 'string') {
    const t = brand.trim();
    return t.length >= 2 ? t : undefined;
  }
  if (brand && typeof brand === 'object' && 'name' in brand) {
    const name = String((brand as { name?: unknown }).name ?? '').trim();
    return name.length >= 2 ? name : undefined;
  }
  return undefined;
}

/** Prepend brand when missing from title (WB-style) so attribute matching can infer brand. */
export function titleWithBrand(title: string, brand?: string): string {
  const t = title.trim();
  if (!brand?.trim()) return t;
  const b = brand.trim();
  if (t.toLowerCase().includes(b.toLowerCase())) return t;
  return `${b} ${t}`.trim();
}

function offerAvailabilityOutOfStock(offer: unknown): boolean {
  if (!offer || typeof offer !== 'object') return false;
  const raw = String((offer as { availability?: unknown }).availability ?? '');
  return /OutOfStock|SoldOut|Discontinued/i.test(raw);
}

type LdProduct = {
  title?: string;
  price?: number;
  image?: string;
  sku?: string;
  brand?: string;
  outOfStock?: boolean;
};

function digitsOnly(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Prefer 6+ digit goods ids (Mega goodsId). */
function plausibleMegaArticle(raw: string | null | undefined): string {
  const d = digitsOnly(raw);
  return d.length >= 6 ? d : '';
}

function parseJsonLdProduct(): LdProduct | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const raw = JSON.parse(script.textContent ?? '');
      const nodes = Array.isArray(raw) ? raw : [raw];
      for (const node of nodes) {
        const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
        for (const item of graph) {
          const type = String(item?.['@type'] ?? '');
          if (!/Product/i.test(type)) continue;
          const offers = item.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          const priceRaw = offer?.price ?? offer?.lowPrice ?? item.price;
          const price = parseRub(String(priceRaw ?? ''));
          const image =
            typeof item.image === 'string'
              ? item.image
              : Array.isArray(item.image)
                ? String(item.image[0] ?? '')
                : '';
          return {
            title: typeof item.name === 'string' ? item.name : undefined,
            price: price ?? undefined,
            image: image || undefined,
            sku: item.sku != null ? String(item.sku) : undefined,
            brand: brandFromLd(item.brand),
            outOfStock: offerAvailabilityOutOfStock(offer),
          };
        }
      }
    } catch {
      // next script
    }
  }
  return null;
}

/**
 * Walk common Mega / Next.js embedded blobs for title/price/goodsId.
 * Best-effort — never invent fields that are not present in JSON.
 */
function parseEmbeddedProductState(): LdProduct | null {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const id = (script.id ?? '').toLowerCase();
    const type = (script.getAttribute('type') ?? '').toLowerCase();
    const isCandidate =
      id === '__next_data__' ||
      id.includes('initial') ||
      type === 'application/json';
    if (!isCandidate) continue;

    const rawText = script.textContent?.trim() ?? '';
    if (!rawText || rawText.length < 20) continue;
    try {
      const data = JSON.parse(rawText) as unknown;
      const found = findProductInUnknown(data, 0);
      if (found) return found;
    } catch {
      // skip
    }
  }
  return null;
}

function findProductInUnknown(node: unknown, depth: number): LdProduct | null {
  if (depth > 8 || node == null) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 40)) {
      const hit = findProductInUnknown(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  const goodsId = plausibleMegaArticle(
    String(obj.goodsId ?? obj.goods_id ?? obj.productId ?? obj.sku ?? ''),
  );
  const titleRaw = obj.title ?? obj.name ?? obj.goodsName ?? obj.productName;
  const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
  const priceRaw =
    obj.price ??
    obj.finalPrice ??
    obj.priceValue ??
    (obj.priceInfo && typeof obj.priceInfo === 'object'
      ? (obj.priceInfo as { price?: unknown }).price
      : undefined);
  const price =
    typeof priceRaw === 'number'
      ? priceRaw > 0
        ? Math.round(priceRaw)
        : undefined
      : (parseRub(String(priceRaw ?? '')) ?? undefined);
  const brand = brandFromLd(obj.brand ?? obj.brandName);
  const oosFlag =
    obj.isAvailable === false ||
    obj.available === false ||
    /out.?of.?stock|недоступ/i.test(String(obj.availability ?? obj.status ?? ''));

  if (title.length >= 2 && (goodsId || (price != null && price > 0))) {
    return {
      title,
      price,
      sku: goodsId || undefined,
      brand,
      outOfStock: oosFlag || undefined,
      image:
        typeof obj.image === 'string'
          ? obj.image
          : typeof obj.imageUrl === 'string'
            ? obj.imageUrl
            : undefined,
    };
  }

  for (const key of [
    'props',
    'pageProps',
    'product',
    'goods',
    'item',
    'data',
    'initialState',
    'state',
  ]) {
    if (key in obj) {
      const hit = findProductInUnknown(obj[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function parseArticleFromDom(url: string): string {
  const fromUrl = extractArticle(url, 'megamarket');
  if (fromUrl) return fromUrl;

  const metaSku =
    document.querySelector('meta[itemprop="sku"]')?.getAttribute('content') ||
    document
      .querySelector('meta[property="product:retailer_item_id"]')
      ?.getAttribute('content') ||
    document.querySelector('[itemprop="sku"]')?.getAttribute('content') ||
    text(document.querySelector('[itemprop="sku"]'));
  const fromMeta = plausibleMegaArticle(metaSku);
  if (fromMeta) return fromMeta;

  const dataId =
    document.querySelector('[data-product-id]')?.getAttribute('data-product-id') ||
    document.querySelector('[data-goods-id]')?.getAttribute('data-goods-id') ||
    document.body?.getAttribute('data-product-id');
  return plausibleMegaArticle(dataId);
}

function parsePriceFromDom(): number | null {
  const metaPrice =
    document.querySelector('meta[itemprop="price"]')?.getAttribute('content') ||
    document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
  if (metaPrice) {
    const p = parseRub(metaPrice);
    if (p != null && p > 0) return p;
  }

  const selectors = [
    '[data-auto="price"]',
    '[itemprop="price"]',
    '[data-test="product-price"]',
    '.price',
    '[class*="Price"]',
    '[class*="price"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const content = el?.getAttribute('content') ?? text(el);
    const price = parseRub(content);
    if (price != null && price > 0) return price;
  }
  const bodyPrice = parseRub(document.body?.innerText?.slice(0, 4000) ?? '');
  return bodyPrice;
}

function parseTitleFromDom(): string {
  const h1 = text(document.querySelector('h1'));
  if (h1 && h1.length > 2) return h1;
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (og?.trim()) {
    return og
      .trim()
      .replace(/\s*[|—–-]\s*Мегамаркет.*$/i, '')
      .replace(/\s*[|—–-]\s*SberMegaMarket.*$/i, '')
      .trim();
  }
  return text(document.querySelector('title'))
    .replace(/\s*[|—–-].*$/, '')
    .trim();
}

function parseImageFromDom(): string | undefined {
  const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (og?.startsWith('http')) return og;
  if (og?.startsWith('//')) return `https:${og}`;
  const img = document.querySelector(
    'img[src*="cdn"], img[src*="megamarket"], img[src*="sbermegamarket"]',
  ) as HTMLImageElement | null;
  return img?.src || undefined;
}

export function isMegamarketOutOfStockText(bodyText: string): boolean {
  return /нет в наличии|товар закончился|распродано|unavailable|out of stock/i.test(bodyText);
}

function isOutOfStock(): boolean {
  return isMegamarketOutOfStockText(document.body?.innerText ?? '');
}

const SELLER_LABEL_RE = /^(продавец|магазин|seller|merchant)$/i;

/**
 * Seller is not on Product — surfaced via pageMeta.specs as `Продавец: …`.
 */
export function scrapeMegamarketSellerFromDom(): string | null {
  for (const row of document.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('th, td');
    if (cells.length < 2) continue;
    const label = cells[0]?.textContent?.trim() ?? '';
    if (!SELLER_LABEL_RE.test(label)) continue;
    const value = cells[1]?.textContent?.trim();
    if (value && value.length >= 2 && value.length < 120) return value;
  }
  for (const dt of document.querySelectorAll('dt')) {
    const label = dt.textContent?.trim() ?? '';
    if (!SELLER_LABEL_RE.test(label)) continue;
    const dd = dt.nextElementSibling;
    const value = dd?.textContent?.trim();
    if (value && value.length >= 2 && value.length < 120) return value;
  }
  const labeled = document.body?.innerText?.match(
    /(?:продавец|магазин)\s*[:：]\s*([^\n·|]{2,80})/i,
  );
  const fromText = labeled?.[1]?.trim();
  if (fromText && fromText.length >= 2) return fromText;
  return null;
}

function mergeLd(primary: LdProduct | null, secondary: LdProduct | null): LdProduct | null {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    title: primary.title || secondary.title,
    price: primary.price ?? secondary.price,
    image: primary.image || secondary.image,
    sku: primary.sku || secondary.sku,
    brand: primary.brand || secondary.brand,
    outOfStock: primary.outOfStock || secondary.outOfStock,
  };
}

export function parseMegamarketProduct(): Product | null {
  const url = toCanonicalProductUrl(window.location.href, 'megamarket');
  if (!/\/catalog\/details\//i.test(url)) return null;

  const ld = mergeLd(parseJsonLdProduct(), parseEmbeddedProductState());
  const rawTitle = (ld?.title ?? parseTitleFromDom()).trim();
  if (!rawTitle || rawTitle.length < 2) return null;
  const title = titleWithBrand(rawTitle, ld?.brand);

  const price = ld?.price ?? parsePriceFromDom() ?? 0;
  const oos = Boolean(ld?.outOfStock) || (price <= 0 && isOutOfStock());
  const article = plausibleMegaArticle(ld?.sku) || parseArticleFromDom(url) || '';
  const color = extractProductFeatures(title).color;

  return {
    id: `megamarket:${article || url}`,
    marketplace: 'megamarket',
    title,
    price: oos ? 0 : price,
    currency: 'RUB',
    article,
    url,
    imageUrl: ld?.image ?? parseImageFromDom(),
    scrapedAt: Date.now(),
    availability: oos ? 'out_of_stock' : price > 0 ? 'in_stock' : undefined,
    ...(color ? { color } : {}),
  };
}
