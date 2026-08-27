/**
 * AliExpress.ru product card scrape (tab-tier).
 * Prefer JSON-LD / runParams-like blobs; fall back to visible DOM.
 * SERP candidates live in search-results.ts (scrapeAliExpressCandidates).
 * No Scrappey / Telegram in this module (ALI-1).
 */
import type { Product } from '@/types/product';
import { extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { parsePrice } from '@/utils/dom';
import { parseListingRubNumbers } from '@/lib/listing-rub-prices';
import { extractProductFeatures } from '@/lib/product-features';
import { normalizeImageCandidate, pickBestCardPrice } from '@/utils/parsers/generic-mp-card';

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

/** Prepend brand when missing from title. */
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

/** Prefer 8+ digit AE product ids (common on aliexpress.ru/item/…). */
export function plausibleAliArticle(raw: string | null | undefined): string {
  const d = digitsOnly(raw);
  return d.length >= 8 ? d : '';
}

/** Build canonical card URL from numeric product id. */
export function buildAliExpressItemUrl(productId: string): string {
  const id = plausibleAliArticle(productId) || digitsOnly(productId);
  if (!id) return 'https://aliexpress.ru/';
  return `https://aliexpress.ru/item/${id}.html`;
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
            sku:
              item.sku != null
                ? String(item.sku)
                : item.productID != null
                  ? String(item.productID)
                  : undefined,
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
 * Best-effort walk of AE / Next embedded JSON for title/price/productId.
 * Never invents fields that are not present.
 */
function parseEmbeddedProductState(): LdProduct | null {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const id = (script.id ?? '').toLowerCase();
    const type = (script.getAttribute('type') ?? '').toLowerCase();
    const rawText = script.textContent ?? '';
    if (rawText.length < 40 || rawText.length > 2_000_000) continue;
    const isCandidate =
      id === '__next_data__' ||
      id.includes('initial') ||
      /runparams|__aer_data__/i.test(id) ||
      type === 'application/json' ||
      /runParams|productId|productInfoComponent/i.test(rawText.slice(0, 500));
    if (!isCandidate) continue;

    try {
      let jsonText = rawText.trim();
      const assign = jsonText.match(
        /(?:window\.)?(?:runParams|__AER_DATA__)\s*=\s*(\{[\s\S]*\});?\s*$/,
      );
      if (assign?.[1]) jsonText = assign[1];
      const data = JSON.parse(jsonText);
      const found = walkForProductFields(data, 0);
      if (found?.title || found?.price || found?.sku) return found;
    } catch {
      const titleM = rawText.match(/"subject"\s*:\s*"((?:\\.|[^"\\]){4,200})"/);
      const priceM = rawText.match(
        /"formatedAmount"\s*:\s*"([^"]+)"|"price"\s*:\s*"?([\d.]+)"?/,
      );
      const idM = rawText.match(/"productId"\s*:\s*"?(\d{8,})"?/);
      if (!titleM && !priceM && !idM) continue;
      const priceRaw = priceM?.[1] || priceM?.[2] || '';
      return {
        title: titleM?.[1]
          ?.replace(/\\"/g, '"')
          .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
        price: parseRub(priceRaw) ?? undefined,
        sku: idM?.[1],
      };
    }
  }
  return null;
}

function walkForProductFields(node: unknown, depth: number): LdProduct | null {
  if (depth > 12 || node == null) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 40)) {
      const hit = walkForProductFields(item, depth + 1);
      if (hit?.title || hit?.price) return hit;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  const title =
    (typeof obj.subject === 'string' && obj.subject) ||
    (typeof obj.title === 'string' && obj.title) ||
    (typeof obj.name === 'string' && obj.name) ||
    undefined;
  const productId =
    plausibleAliArticle(String(obj.productId ?? obj.productID ?? obj.itemId ?? '')) || undefined;
  const priceObj = obj.price as { formatedAmount?: unknown; value?: unknown } | undefined;
  const priceRaw =
    obj.formatedAmount ??
    obj.formattedPrice ??
    priceObj?.formatedAmount ??
    priceObj?.value ??
    obj.minPrice ??
    obj.actSkuPrice ??
    obj.price;
  const price = parseRub(String(priceRaw ?? ''));
  const image =
    typeof obj.imagePath === 'string'
      ? obj.imagePath
      : typeof obj.image === 'string'
        ? obj.image
        : undefined;

  if (title || (price != null && price > 0) || productId) {
    return {
      title: title?.trim() || undefined,
      price: price ?? undefined,
      image: image ? normalizeImageCandidate(image) ?? image : undefined,
      sku: productId,
      brand: brandFromLd(obj.brand),
    };
  }

  for (const key of [
    'data',
    'props',
    'pageProps',
    'productInfoComponent',
    'priceComponent',
    'product',
    'result',
  ]) {
    if (key in obj) {
      const hit = walkForProductFields(obj[key], depth + 1);
      if (hit?.title || hit?.price || hit?.sku) return hit;
    }
  }
  return null;
}

function parseArticleFromDom(url: string): string {
  const fromUrl = extractArticle(url, 'aliexpress');
  if (plausibleAliArticle(fromUrl)) return fromUrl;
  const meta =
    document.querySelector('meta[property="product:retailer_item_id"]')?.getAttribute('content') ||
    document.querySelector('meta[itemprop="sku"]')?.getAttribute('content') ||
    document.querySelector('meta[itemprop="productID"]')?.getAttribute('content');
  return plausibleAliArticle(meta) || '';
}

function collectDomPriceCandidates(): number[] {
  const out: number[] = [];
  const selectors = [
    '[itemprop="price"]',
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
    '[class*="price" i]',
    '[class*="Price" i]',
    '[data-spm*="price" i]',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (sel.includes('class*') && (el.textContent?.length ?? 0) > 120) continue;
      const content =
        el.getAttribute('content') ||
        el.getAttribute('data-price') ||
        el.getAttribute('value') ||
        text(el);
      const price = parseRub(content);
      if (price != null && price > 0) out.push(price);
    }
  }
  return out;
}

function parsePriceFromDom(): number | null {
  const structured = collectDomPriceCandidates();
  const bodyPrice = parseRub(document.body?.innerText?.slice(0, 3500) ?? '');
  return pickBestCardPrice([...structured, bodyPrice]);
}

function parseTitleFromDom(): string {
  const h1 = text(document.querySelector('h1'));
  if (h1 && h1.length > 2) return h1;
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (og?.trim()) {
    return og
      .trim()
      .replace(/\s*[|—–-]\s*AliExpress.*$/i, '')
      .replace(/\s*[|—–-]\s*АлиЭкспресс.*$/i, '')
      .trim();
  }
  return text(document.querySelector('title'))
    .replace(/\s*[|—–-].*$/, '')
    .trim();
}

function parseImageFromDom(): string | undefined {
  const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const fromOg = normalizeImageCandidate(og);
  if (fromOg) return fromOg;
  const img = document.querySelector(
    'img[src*="alicdn"], img[src*="aliexpress"], img[class*="gallery" i]',
  ) as HTMLImageElement | null;
  return (
    normalizeImageCandidate(img?.currentSrc || img?.src) ||
    normalizeImageCandidate(img?.getAttribute('data-src')) ||
    undefined
  );
}

export function isAliExpressOutOfStockText(bodyText: string): boolean {
  return /нет в наличии|товар недоступен|снят с продажи|распродано|unavailable|out of stock|sold out|currently unavailable/i.test(
    bodyText,
  );
}

function isOutOfStock(): boolean {
  return isAliExpressOutOfStockText(document.body?.innerText ?? '');
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

export function parseAliExpressProduct(): Product | null {
  const url = toCanonicalProductUrl(window.location.href, 'aliexpress');
  if (!/\/item\/\d+/i.test(url)) return null;

  const ld = mergeLd(parseJsonLdProduct(), parseEmbeddedProductState());
  const rawTitle = (ld?.title ?? parseTitleFromDom()).trim();
  if (!rawTitle || rawTitle.length < 2) return null;
  const title = titleWithBrand(rawTitle, ld?.brand);

  const price = pickBestCardPrice([ld?.price, parsePriceFromDom()]) ?? 0;
  const oos = Boolean(ld?.outOfStock) || (price <= 0 && isOutOfStock());
  const article =
    plausibleAliArticle(ld?.sku) || parseArticleFromDom(url) || plausibleAliArticle(url) || '';
  const color = extractProductFeatures(title).color;
  const imageUrl = normalizeImageCandidate(ld?.image) ?? parseImageFromDom();

  return {
    id: `aliexpress:${article || url}`,
    marketplace: 'aliexpress',
    title,
    price: oos ? 0 : price,
    currency: 'RUB',
    article,
    url,
    imageUrl,
    color: color || undefined,
    scrapedAt: Date.now(),
    availability: oos ? 'out_of_stock' : price > 0 ? 'in_stock' : undefined,
  };
}
