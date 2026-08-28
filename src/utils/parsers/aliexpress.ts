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

/** Shipping / courier fee context — must not win over «цена сейчас». */
const ALI_SHIPPING_CTX =
  /доставк|курьер|пункт\s*выдач|почт(ой|а|ью|ой)|shipping|freight|logistic|delivery|стоимость\s*доставк/i;

const ALI_DELIVERY_CLOSEST =
  '[class*="deliver" i], [class*="shipping" i], [class*="logistic" i], [class*="freight" i], [data-spm*="ship" i], [data-spm*="logistics" i]';

export function isAliShippingPriceContext(raw: string): boolean {
  return ALI_SHIPPING_CTX.test(raw);
}

/**
 * Drop courier fees when a product-price cluster exists.
 * 637₽ mail vs 1999₽ dummy, 280₽ courier vs 16489₽ phone → keep retail cluster.
 */
export function filterAliProductPrices(candidates: number[]): number[] {
  const nums = [
    ...new Set(
      candidates
        .filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
        .map((n) => Math.round(n)),
    ),
  ].sort((a, b) => a - b);
  if (nums.length <= 1) return nums;
  const max = nums[nums.length - 1]!;
  if (max < 1_000) return nums;
  // Mid retail (1–5k): shipping often 30–40% of price → need ~0.4 floor.
  // High retail (5k+): shipping is tiny → 0.12 floor enough.
  const floor =
    max >= 5_000
      ? Math.max(500, Math.floor(max * 0.12))
      : Math.max(400, Math.floor(max * 0.4));
  const kept = nums.filter((n) => n >= floor);
  return kept.length ? kept : nums;
}

/** Prefer product price over shipping: filter then lowest retail (sale vs strike). */
export function pickAliExpressCardPrice(
  candidates: Array<number | null | undefined>,
): number | null {
  const filtered = filterAliProductPrices(
    candidates.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0),
  );
  return pickBestCardPrice(filtered);
}

/** «16 489 ₽» immediately above «цена сейчас» on AE.ru cards. */
export function parseAliPriceNowFromText(raw: string): number | null {
  const m =
    raw.match(/(\d[\d\s\u00a0]{2,})\s*₽\s*цена\s*сейчас/i) ||
    raw.match(/цена\s*сейчас\s*(\d[\d\s\u00a0]{2,})\s*₽/i);
  if (!m?.[1]) return null;
  return parseRub(m[1]);
}

const ALI_LD_RETAIL_FLOOR = 500;

/**
 * Resolve final card price: цена сейчас → LD (if DOM is a fee) → filtered DOM.
 * Optional referencePrice: if picked price ≪ ref but page has цена сейчас / LD, prefer those.
 */
export function resolveAliExpressProductPrice(input: {
  priceNow?: number | null;
  ldPrice?: number | null;
  domPrice?: number | null;
  referencePrice?: number | null;
}): number | null {
  const priceNow = input.priceNow != null && input.priceNow >= 100 ? Math.round(input.priceNow) : null;
  const ld =
    input.ldPrice != null && input.ldPrice >= ALI_LD_RETAIL_FLOOR
      ? Math.round(input.ldPrice)
      : null;
  const dom = input.domPrice != null && input.domPrice > 0 ? Math.round(input.domPrice) : null;
  const ref =
    input.referencePrice != null && input.referencePrice > 0
      ? Math.round(input.referencePrice)
      : null;

  // DOM fee must not beat structured LD (280 vs 16489).
  let picked: number | null = null;
  if (priceNow != null) {
    picked = priceNow;
  } else if (ld != null && (dom == null || dom < ld * 0.15)) {
    picked = ld;
  } else {
    picked = pickAliExpressCardPrice([ld, dom, priceNow]);
  }

  if (ref != null && picked != null && picked < ref * 0.15) {
    if (priceNow != null && priceNow >= ref * 0.15) return priceNow;
    if (ld != null && ld >= ref * 0.15) return ld;
  }
  return picked;
}

function isInsideAliDeliveryBlock(el: Element): boolean {
  // Semantic delivery containers only — do not use body/sidebar text (mixes price + shipping).
  return Boolean(el.closest?.(ALI_DELIVERY_CLOSEST));
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
      if (isInsideAliDeliveryBlock(el)) continue;
      // Only self / class hints — not ancestor sidebar text (mixes price + «почтой»).
      const selfText = text(el);
      const cls = `${el.getAttribute('class') ?? ''} ${el.getAttribute('data-spm') ?? ''}`;
      if (
        (isAliShippingPriceContext(selfText) || isAliShippingPriceContext(cls)) &&
        !/цена\s*сейчас/i.test(selfText)
      ) {
        continue;
      }
      const content =
        el.getAttribute('content') ||
        el.getAttribute('data-price') ||
        el.getAttribute('value') ||
        selfText;
      if (/курьер|почт|доставк/i.test(content) && !/цена\s*сейчас/i.test(content)) continue;
      const price = parseRub(content);
      if (price != null && price > 0) out.push(price);
    }
  }
  return out;
}

/** DOM prices only — never raw body.innerText (shipping fees live there). */
function parsePriceFromDom(): number | null {
  const structured = collectDomPriceCandidates();
  return pickAliExpressCardPrice(structured);
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

export function parseAliExpressProduct(opts?: { referencePrice?: number }): Product | null {
  const url = toCanonicalProductUrl(window.location.href, 'aliexpress');
  if (!/\/item\/\d+/i.test(url)) return null;

  const ld = mergeLd(parseJsonLdProduct(), parseEmbeddedProductState());
  const rawTitle = (ld?.title ?? parseTitleFromDom()).trim();
  if (!rawTitle || rawTitle.length < 2) return null;
  const title = titleWithBrand(rawTitle, ld?.brand);

  const bodySnippet = document.body?.innerText?.slice(0, 8_000) ?? '';
  const priceNow = parseAliPriceNowFromText(bodySnippet);
  const domPrice = parsePriceFromDom();
  const price =
    resolveAliExpressProductPrice({
      priceNow,
      ldPrice: ld?.price,
      domPrice,
      referencePrice: opts?.referencePrice,
    }) ?? 0;
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
