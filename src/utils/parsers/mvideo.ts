/**
 * М.Видео / Эльдорадо product card scrape (tab-tier, id `mvideo`).
 * JSON-LD + preferred DOM prices; SERP candidates in search-results.ts.
 * No Scrappey / Telegram / default-on (MVIDEO-1).
 */
import type { Product } from '@/types/product';
import { extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { parsePrice } from '@/utils/dom';
import { parseListingRubNumbers } from '@/lib/listing-rub-prices';
import { extractProductFeatures } from '@/lib/product-features';
import {
  normalizeImageCandidate,
  parseImageFromDomRoot,
  pickBestCardPrice,
} from '@/utils/parsers/generic-mp-card';
import { getTabSearchAdapter } from '@/lib/marketplaces/adapter-config';

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

export function isMvideoOutOfStockText(raw: string): boolean {
  return /нет в наличии|товар закончился|распродано|unavailable|out of stock|sold out|временно недоступен/i.test(
    raw,
  );
}

/** 6+ digit retail product ids on mvideo.ru slugs / eldorado item paths. */
export function plausibleMvideoArticle(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length >= 6 ? d : '';
}

type LdProduct = {
  title?: string;
  price?: number;
  image?: string;
  sku?: string;
  brand?: string;
  outOfStock?: boolean;
};

function imageFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') return normalizeImageCandidate(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = imageFromUnknown(item);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      imageFromUnknown(obj.url) ||
      imageFromUnknown(obj.contentUrl) ||
      imageFromUnknown(obj['@id'])
    );
  }
  return null;
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
          return {
            title: typeof item.name === 'string' ? item.name : undefined,
            price: price ?? undefined,
            image: imageFromUnknown(item.image) ?? undefined,
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

function collectDomPriceCandidates(): number[] {
  const out: number[] = [];
  const selectors = [
    '.price__main-value',
    '.price__sale-value',
    '[class*="price__main"]',
    '[itemprop="price"]',
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
    '[data-auto="price"]',
    '[data-testid*="price" i]',
    '[class*="price" i]',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (sel.includes('class*="price"') && (el.textContent?.length ?? 0) > 80) continue;
      const content =
        el.getAttribute('content') ||
        el.getAttribute('data-price') ||
        el.getAttribute('value') ||
        text(el);
      const price = parseRub(content);
      if (price != null && price > 0) out.push(price);
      if (sel === '.price__main-value' && price != null && price >= 100) {
        return [price];
      }
    }
  }
  return out;
}

function parseTitleFromDom(): string {
  const h1 = text(document.querySelector('h1'));
  if (h1 && h1.length > 2) return h1;
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (og?.trim()) return og.trim();
  return text(document.querySelector('title')).replace(/\s*[|—–-].*$/, '').trim();
}

function isOutOfStockDom(): boolean {
  return isMvideoOutOfStockText(document.body?.innerText ?? '');
}

/**
 * Card scrape for mvideo.ru / eldorado.ru.
 * Returns null on SERP / non-product pages — never invents an offer.
 */
export function parseMvideoProduct(): Product | null {
  const cfg = getTabSearchAdapter('mvideo');
  if (!cfg) return null;

  const url = toCanonicalProductUrl(window.location.href, 'mvideo');
  if (!cfg.isProductPage(url)) return null;

  const ld = parseJsonLdProduct();
  const rawTitle = (ld?.title ?? parseTitleFromDom()).trim();
  if (!rawTitle || rawTitle.length < 2) return null;
  const title = titleWithBrand(rawTitle, ld?.brand);

  const price = pickBestCardPrice([ld?.price, ...collectDomPriceCandidates()]) ?? 0;
  const oos = Boolean(ld?.outOfStock) || (price <= 0 && isOutOfStockDom());
  const article =
    plausibleMvideoArticle(ld?.sku) ||
    plausibleMvideoArticle(extractArticle(url, 'mvideo')) ||
    extractArticle(url, 'mvideo') ||
    '';
  const imageUrl =
    normalizeImageCandidate(ld?.image) ?? parseImageFromDomRoot(document) ?? undefined;
  const color = extractProductFeatures(title).color;

  return {
    id: `mvideo:${article || url}`,
    marketplace: 'mvideo',
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
