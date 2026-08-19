/**
 * Identity guards for price history / drop alerts.
 * Price updates and alerts must bind to marketplace + article / canonical URL —
 * never to similar title, close price, or unstable Product.id alone.
 */

import { isSameProductPage } from '@/lib/reviews/tab-resolver';
import type { Marketplace } from '@/types/product';
import { extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';

export type PriceIdentityRef = {
  marketplace: Marketplace;
  article?: string | null;
  url?: string | null;
  id?: string | null;
  title?: string | null;
};

export type IdentityMatchResult =
  | { ok: true; article: string; reason: 'article' | 'url' }
  | { ok: false; reason: string };

const UNSTABLE_ARTICLES = new Set(['', 'ym', '0', 'unknown', 'null', 'undefined']);

/** Strip wb-/ozon-/yandex-/ym- prefixes from Product.id or cloud product_id. */
export function bareProductArticle(
  marketplace: Marketplace,
  value: string | null | undefined,
): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';

  if (marketplace === 'wildberries' && /^wb-/i.test(raw)) {
    return raw.replace(/^wb-/i, '');
  }
  if (marketplace === 'ozon' && /^ozon-/i.test(raw)) {
    return raw.replace(/^ozon-/i, '');
  }
  if (marketplace === 'yandex_market') {
    return raw.replace(/^(yandex_market|yandex|ym)-/i, '');
  }
  return raw;
}

export function isStableArticle(article: string | null | undefined): boolean {
  const a = (article ?? '').trim();
  if (!a || UNSTABLE_ARTICLES.has(a.toLowerCase())) return false;
  // Prefer numeric marketplace SKUs (WB/Ozon/YM)
  if (/^\d{4,}$/.test(a)) return true;
  // Rare alphanumeric SKUs — allow if long enough and not a placeholder
  return a.length >= 6 && !/^yandex-?$/i.test(a);
}

/** Resolve marketplace SKU from article, URL, or prefixed id. */
export function resolveProductArticle(ref: PriceIdentityRef): string {
  const fromField = bareProductArticle(ref.marketplace, ref.article);
  if (isStableArticle(fromField)) return fromField;

  if (ref.url) {
    try {
      const canonical = toCanonicalProductUrl(ref.url, ref.marketplace);
      const fromUrl = extractArticle(canonical, ref.marketplace);
      if (isStableArticle(fromUrl)) return fromUrl;
    } catch {
      const fromUrl = extractArticle(ref.url, ref.marketplace);
      if (isStableArticle(fromUrl)) return fromUrl;
    }
  }

  const fromId = bareProductArticle(ref.marketplace, ref.id);
  if (isStableArticle(fromId)) return fromId;

  return '';
}

/** Stable storage / history key (`wb-{nmId}` …) or null if identity is weak. */
export function stableProductStorageId(ref: PriceIdentityRef): string | null {
  const article = resolveProductArticle(ref);
  if (!article) return null;
  if (ref.marketplace === 'wildberries') return `wb-${article}`;
  if (ref.marketplace === 'ozon') return `ozon-${article}`;
  return `yandex-${article}`;
}

export function logPriceIdentityReject(
  tracked: PriceIdentityRef | null | undefined,
  scraped: PriceIdentityRef,
  reason: string,
): void {
  console.warn('[PriceGuard] price-identity reject', {
    reason,
    tracked: tracked
      ? {
          marketplace: tracked.marketplace,
          article: tracked.article,
          url: tracked.url,
          id: tracked.id,
          title: tracked.title?.slice(0, 80),
        }
      : null,
    scraped: {
      marketplace: scraped.marketplace,
      article: scraped.article,
      url: scraped.url,
      id: scraped.id,
      title: scraped.title?.slice(0, 80),
      price: (scraped as { price?: number }).price,
    },
  });
}

/**
 * Primary identity: same marketplace + same article, and/or same canonical product URL.
 * Title / price proximity alone never count.
 */
export function productsIdentityMatch(
  expected: PriceIdentityRef,
  actual: PriceIdentityRef,
): IdentityMatchResult {
  if (expected.marketplace !== actual.marketplace) {
    return { ok: false, reason: 'marketplace_mismatch' };
  }

  const expArt = resolveProductArticle(expected);
  const actArt = resolveProductArticle(actual);

  if (expArt && actArt) {
    if (expArt === actArt) {
      return { ok: true, article: expArt, reason: 'article' };
    }
    return { ok: false, reason: 'article_mismatch' };
  }

  if (expected.url && actual.url) {
    if (isSameProductPage(expected.url, actual.url)) {
      const article = expArt || actArt;
      if (article) {
        return { ok: true, article, reason: 'url' };
      }
      // Same page but still no SKU — too weak for alerts
      return { ok: false, reason: 'url_match_without_article' };
    }
    return { ok: false, reason: 'url_mismatch' };
  }

  if (!expArt || !actArt) {
    return { ok: false, reason: 'missing_article' };
  }

  return { ok: false, reason: 'no_identity' };
}

/** Huge apparent drop without proven identity → suppress (SPA / wrong SKU). */
export function isSuspiciousIdentityDrop(
  previousPrice: number,
  newPrice: number,
  identityOk: boolean,
): boolean {
  if (identityOk) return false;
  if (!(previousPrice > 0) || !(newPrice > 0) || newPrice >= previousPrice) return false;
  const dropPct = (previousPrice - newPrice) / previousPrice;
  return dropPct >= 0.4 || previousPrice - newPrice >= 5_000;
}

export function assertScrapedPriceIdentity(
  tracked: PriceIdentityRef,
  scraped: PriceIdentityRef,
): IdentityMatchResult {
  const match = productsIdentityMatch(tracked, scraped);
  if (!match.ok) {
    logPriceIdentityReject(tracked, scraped, match.reason);
  }
  return match;
}

/** Popup: live scraped product vs tracked list (id may differ after restart). */
export function isLiveProductInTrackedList(
  live: PriceIdentityRef,
  tracked: PriceIdentityRef[],
): boolean {
  return tracked.some((item) => productsIdentityMatch(item, live).ok);
}
