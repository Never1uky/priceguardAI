/** Найти вкладку с карточкой товара (не только активную — popup может быть открыт поверх другой вкладки). */

import { extractComparisonArticle, detectComparisonMarketplace } from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';

export function normalizeProductTabUrl(url: string): string {
  try {
    const mp = detectComparisonMarketplace(url);
    const canonical = mp ? toCanonicalProductUrl(url, mp) : url;
    const parsed = new URL(canonical.trim());
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function extractProductId(url: string): string | null {
  const mp = detectComparisonMarketplace(url);
  if (!mp) return null;

  const fromArticle = extractComparisonArticle(url, mp);
  if (fromArticle) return fromArticle;

  if (mp === 'wildberries') {
    return url.match(/\/catalog\/(\d+)/i)?.[1] ?? null;
  }

  if (mp === 'ozon') {
    return url.match(/\/product\/[^/]+-(\d+)/i)?.[1] ?? url.match(/\/id\/(\d+)/i)?.[1] ?? null;
  }

  if (mp === 'yandex_market') {
    return (
      url.match(/\/product(?:--[^/]+)?\/(\d+)/i)?.[1] ??
      url.match(/\/card\/[^/]+\/(\d+)/i)?.[1] ??
      url.match(/\/(\d{6,12})(?:[/?#]|$)/i)?.[1] ??
      null
    );
  }

  return null;
}

function urlsMatchProductTab(tabUrl: string, productUrl: string): boolean {
  const a = normalizeProductTabUrl(tabUrl);
  const b = normalizeProductTabUrl(productUrl);
  if (a === b) return true;

  const idA = extractProductId(a);
  const idB = extractProductId(b);
  if (idA && idB && idA === idB) return true;

  if (idB && a.includes(idB)) return true;

  return false;
}

/** Одна карточка товара: detail, /reviews, query — считаем одним товаром. */
export function isSameProductPage(urlA: string, urlB: string): boolean {
  return urlsMatchProductTab(urlA, urlB);
}

export async function findTabForProduct(productUrl: string): Promise<chrome.tabs.Tab | null> {
  if (!productUrl) return null;

  const tabs = await chrome.tabs.query({});
  const match = tabs.find((tab) => tab.url && urlsMatchProductTab(tab.url, productUrl));
  if (match) return match;

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && urlsMatchProductTab(active.url, productUrl)) return active;

  return null;
}
