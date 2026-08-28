/**
 * Generic product-card scrape for test marketplaces (JSON-LD + visible DOM).
 * Returns null when title is missing — never invents an offer.
 */
import type { Marketplace, Product } from '@/types/product';
import { extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { parsePrice } from '@/utils/dom';
import { parseListingRubNumbers } from '@/lib/listing-rub-prices';
import {
  getTabSearchAdapter,
  isGenericCardMarketplace,
} from '@/lib/marketplaces/adapter-config';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseRub(raw: string): number | null {
  const fromDom = parsePrice(raw);
  if (fromDom > 0) return fromDom;
  const nums = parseListingRubNumbers(raw);
  return nums[0] ?? null;
}

/** Absolute https URL or null; accepts protocol-relative //cdn… */
export function normalizeImageCandidate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  if (s.startsWith('http://')) s = `https://${s.slice(7)}`;
  if (!/^https:\/\//i.test(s)) return null;
  const lower = s.toLowerCase();
  if (
    /pixel|spacer|1x1|sprite|logo|favicon|data:image\/svg|magnolia|\/banners?\//i.test(lower) ||
    /\.svg(\?|$)/i.test(lower) ||
    /cms\.mvideo\.ru/i.test(lower) ||
    /assets\/icons\//i.test(lower) ||
    /files\/cms\//i.test(lower)
  ) {
    return null;
  }
  return s.split('#')[0] ?? s;
}

/** Prefer real product gallery CDNs over banners / UI chrome. */
export function scoreProductImageUrl(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (/product-medias|product-images|\/product\//i.test(u)) score += 50;
  if (/img\.mvideo\.ru|a\.lmcdn\.ru|lmcdn\.ru|cdn\.citilink\.ru|alicdn\.com/i.test(u)) score += 30;
  if (/width=150|img46x66|width:55|height:55/i.test(u)) score -= 15;
  if (/width:1920|height:80|nw_banne/i.test(u)) score -= 80;
  return score;
}

function firstSrcFromSrcset(srcset: string): string | null {
  const part = srcset.split(',')[0]?.trim().split(/\s+/)[0];
  return part ? normalizeImageCandidate(part) : null;
}

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

function parseJsonLdProduct(): {
  title?: string;
  price?: number;
  image?: string;
  sku?: string;
} | null {
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
            sku: item.sku != null ? String(item.sku) : undefined,
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
    '[itemprop="price"]',
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
    '[data-auto="price"]',
    '[data-testid*="price" i]',
    // Broad class match last — parents often mix specs («6 ГБ») with price
    '[class*="price" i]',
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
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

/**
 * Prefer structured prices; discard tiny junk (ratings/bonuses) when a larger price exists.
 * Floor 100₽ for retail electronics-like cards.
 * When several prices ≥100 exist, prefer the lowest (sale vs strikethrough).
 */
export function pickBestCardPrice(candidates: Array<number | null | undefined>): number | null {
  const nums = candidates
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
  if (!nums.length) return null;
  const aboveFloor = nums.filter((n) => n >= 100);
  if (!aboveFloor.length) return null;
  // Cluster: drop outliers >1.6× the median of mid-range retail prices
  aboveFloor.sort((a, b) => a - b);
  return aboveFloor[0]!;
}

function parsePriceFromDom(_marketplace: Marketplace): number | null {
  const structured = collectDomPriceCandidates();
  const bodyPrice = parseRub(document.body?.innerText?.slice(0, 2500) ?? '');
  return pickBestCardPrice([...structured, bodyPrice]);
}

function parseTitleFromDom(): string {
  const h1 = text(document.querySelector('h1'));
  if (h1 && h1.length > 2) return h1;
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (og?.trim()) return og.trim();
  return text(document.querySelector('title')).replace(/\s*[|—–-].*$/, '').trim();
}

export function parseImageFromDomRoot(root: ParentNode = document): string | undefined {
  const candidates: string[] = [];
  const push = (raw: string | null | undefined) => {
    const n = normalizeImageCandidate(raw);
    if (n) candidates.push(n);
  };

  push(root.querySelector?.('meta[property="og:image"]')?.getAttribute('content'));
  push(root.querySelector?.('meta[name="twitter:image"]')?.getAttribute('content'));
  push(root.querySelector?.('meta[property="og:image:secure_url"]')?.getAttribute('content'));
  push(root.querySelector?.('link[rel="image_src"]')?.getAttribute('href'));

  const itemprop = root.querySelector?.('img[itemprop="image"]') as HTMLImageElement | null;
  if (itemprop) {
    push(itemprop.currentSrc || itemprop.src);
    push(itemprop.getAttribute('data-src'));
    push(itemprop.getAttribute('data-original'));
    push(firstSrcFromSrcset(itemprop.getAttribute('srcset') ?? '') ?? undefined);
  }

  const imgs = root.querySelectorAll?.('img') ?? [];
  for (const img of imgs) {
    const el = img as HTMLImageElement;
    push(el.currentSrc || el.src);
    push(el.getAttribute('data-src'));
    push(el.getAttribute('data-original'));
    push(el.getAttribute('data-lazy-src'));
    push(firstSrcFromSrcset(el.getAttribute('srcset') ?? '') ?? undefined);
    push(firstSrcFromSrcset(el.getAttribute('data-srcset') ?? '') ?? undefined);
  }

  if (!candidates.length) return undefined;
  candidates.sort((a, b) => scoreProductImageUrl(b) - scoreProductImageUrl(a));
  return candidates[0];
}

function isOutOfStock(): boolean {
  const t = (document.body?.innerText ?? '').toLowerCase();
  return /нет в наличии|товар закончился|распродано|unavailable|out of stock|sold out/i.test(t);
}

export function parseGenericMarketplaceProduct(marketplace: Marketplace): Product | null {
  if (!isGenericCardMarketplace(marketplace)) return null;
  const cfg = getTabSearchAdapter(marketplace);
  if (!cfg) return null;

  const url = toCanonicalProductUrl(window.location.href, marketplace);
  if (!cfg.isProductPage(url)) return null;

  const ld = parseJsonLdProduct();
  const title = (ld?.title ?? parseTitleFromDom()).trim();
  if (!title || title.length < 2) return null;

  const price = pickBestCardPrice([ld?.price, parsePriceFromDom(marketplace)]) ?? 0;
  const oos = price <= 0 && isOutOfStock();
  const article = (ld?.sku && String(ld.sku).trim()) || extractArticle(url, marketplace) || '';
  const imageUrl =
    normalizeImageCandidate(ld?.image) ?? parseImageFromDomRoot(document) ?? undefined;

  return {
    id: `${marketplace}:${article || url}`,
    marketplace,
    title,
    price: oos ? 0 : price,
    currency: 'RUB',
    article,
    url,
    imageUrl,
    scrapedAt: Date.now(),
    availability: oos ? 'out_of_stock' : price > 0 ? 'in_stock' : undefined,
  };
}
