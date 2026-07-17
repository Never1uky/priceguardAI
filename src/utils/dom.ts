/** Универсальные DOM-утилиты для парсинга маркетплейсов */

import { toCanonicalProductUrl } from '@/utils/product-url';

const PRICE_PATTERN = /(\d[\d\s\u00a0]*\d|\d)\s*(?:₽|руб\.?|RUB)?/i;

export function parsePrice(text: string | null | undefined): number {
  if (!text) return 0;
  const normalized = text.replace(/\u00a0/g, ' ').trim();
  const match = normalized.match(/(\d[\d\s]*\d|\d)/);
  if (!match) return 0;
  const digits = match[1].replace(/\s/g, '');
  const value = parseInt(digits, 10);
  return Number.isFinite(value) ? value : 0;
}

export function queryFirst<T extends Element = Element>(
  selectors: string[],
  root?: ParentNode | null,
): T | null {
  if (typeof document === 'undefined' && !root) return null;
  const scope = root ?? document;
  for (const selector of selectors) {
    try {
      const element = scope.querySelector<T>(selector);
      if (element) return element;
    } catch {
      // Невалидный селектор — пропускаем
    }
  }
  return null;
}

export function queryAll(selectors: string[], root?: ParentNode | null): Element[] {
  if (typeof document === 'undefined' && !root) return [];
  const scope = root ?? document;
  for (const selector of selectors) {
    try {
      const elements = scope.querySelectorAll(selector);
      if (elements.length > 0) return Array.from(elements);
    } catch {
      // skip
    }
  }
  return [];
}

export function getTextFromSelectors(selectors: string[], root?: ParentNode): string | undefined {
  const element = queryFirst(selectors, root);
  const text = element?.textContent?.trim();
  return text || undefined;
}

export function getMetaContent(names: string[]): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const name of names) {
    const byProperty = document.querySelector<HTMLMetaElement>(`meta[property="${name}"]`);
    if (byProperty?.content?.trim()) return byProperty.content.trim();

    const byName = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (byName?.content?.trim()) return byName.content.trim();
  }
  return undefined;
}

export function getJsonLdProducts(): Array<Record<string, unknown>> {
  if (typeof document === 'undefined') return [];
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');
  const products: Array<Record<string, unknown>> = [];

  scripts.forEach((script) => {
    try {
      const data = JSON.parse(script.textContent ?? '') as unknown;
      collectJsonLdProducts(data, products);
    } catch {
      // ignore invalid JSON-LD
    }
  });

  return products;
}

function collectJsonLdProducts(data: unknown, acc: Array<Record<string, unknown>>): void {
  if (!data || typeof data !== 'object') return;

  if (Array.isArray(data)) {
    data.forEach((item) => collectJsonLdProducts(item, acc));
    return;
  }

  const record = data as Record<string, unknown>;
  const type = record['@type'];

  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
    acc.push(record);
  }

  if (record['@graph']) {
    collectJsonLdProducts(record['@graph'], acc);
  }
}

export function extractPriceFromJsonLd(
  product: Record<string, unknown>,
): { price?: number; oldPrice?: number } {
  const offers = product.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;

  if (!offer || typeof offer !== 'object') return {};

  const offerRecord = offer as Record<string, unknown>;
  const price = parsePrice(String(offerRecord.price ?? offerRecord.lowPrice ?? ''));
  const highPrice = parsePrice(String(offerRecord.highPrice ?? ''));

  const result: { price?: number; oldPrice?: number } = {};
  if (price > 0) result.price = price;
  if (highPrice > price && highPrice > 0) result.oldPrice = highPrice;

  return result;
}

export function findPricesInRoot(root: ParentNode): number[] {
  const prices = new Set<number>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    if (PRICE_PATTERN.test(text)) {
      const value = parsePrice(text);
      if (value >= 50 && value <= 50_000_000) {
        prices.add(value);
      }
    }
    node = walker.nextNode();
  }

  return Array.from(prices).sort((a, b) => a - b);
}

export function pickCurrentAndOldPrice(candidates: number[]): {
  price?: number;
  oldPrice?: number;
} {
  const unique = [...new Set(candidates.filter((p) => p > 0))].sort((a, b) => a - b);
  if (unique.length === 0) return {};
  if (unique.length === 1) return { price: unique[0] };

  const price = unique[0];
  const oldPrice = unique[unique.length - 1];

  if (oldPrice > price * 1.02) {
    return { price, oldPrice };
  }

  return { price: unique[0] };
}

export function getStrikethroughPrices(root: ParentNode = document): number[] {
  const selectors = ['del', 's', '[class*="old"]', '[class*="Old"]', '[class*="crossed"]'];
  const prices: number[] = [];

  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach((element) => {
      const value = parsePrice(element.textContent);
      if (value > 0) prices.push(value);
    });
  }

  return prices;
}

export function cleanTitle(title: string, marketplace?: string): string {
  let result = title
    .replace(/\s*[|/–—-]\s*(Wildberries|Ozon|Вайлдберриз|Озон).*$/i, '')
    .replace(/\s+купить.*$/i, '')
    .trim();

  if (marketplace === 'wildberries') {
    result = result.replace(/,\s*цена:\s*\d+.*$/i, '').trim();
  }

  return result;
}

export function canonicalUrl(): string {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const raw = canonical ? canonical.split('?')[0] : window.location.href.split('?')[0].split('#')[0];
  return toCanonicalProductUrl(raw);
}

export function getImageFromSelectors(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;

    if (element instanceof HTMLMetaElement && element.content) {
      return element.content;
    }

    if (element instanceof HTMLImageElement) {
      const src = pickImageSrc(element);
      if (src) return src;
    }

    const src =
      element.getAttribute('src') ??
      element.getAttribute('data-src') ??
      element.getAttribute('data-original') ??
      element.getAttribute('data-lazy-src');
    if (src && !src.startsWith('data:')) return src;
  }

  return getMetaContent(['og:image', 'twitter:image']);
}

function pickImageSrc(img: HTMLImageElement): string | undefined {
  const candidates = [
    img.currentSrc,
    img.src,
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
  ].filter((v): v is string => Boolean(v && !v.startsWith('data:')));

  if (candidates.length) return candidates[0];

  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
    if (first && !first.startsWith('data:')) return first;
  }

  return undefined;
}
