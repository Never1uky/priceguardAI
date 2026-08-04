/**
 * Ozon SERP DOM fallback + antibot heuristics (no Scrappey).
 * Used from hidden-tab search when composer widgetStates are empty.
 */

import type { MarketplaceOffer } from '@/types/comparison';
import { parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import { attachPickHistoryBoosts } from '@/lib/pick-history';
import { pickTopMatchesWithScore, isUrlExcluded } from '@/lib/product-match';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import { parsePrice } from '@/utils/dom';
import { isSafeMarketplaceUrl } from '@/utils/safe-marketplace-url';
import { pickSerpTitleFromTile, sanitizeCandidateTitle } from '@/lib/serp-title';

export const OZON_ANTIBOT_USER_MESSAGE =
  'Ozon временно ограничивает автоматический поиск. Укажите ссылку на карточку вручную.';

export const VPN_SEARCH_HINT =
  'Поиск не удался — отключите VPN или adblock.';

export type OzonSerpDomCandidate = {
  title: string;
  url: string;
  price: number | null;
  oldPrice?: number;
  rating?: number | null;
  reviewCount?: number;
};

export type OzonSerpDomScan = {
  antibot: boolean;
  candidates: OzonSerpDomCandidate[];
};

function parseRubPrices(text: string): number[] {
  return [...text.replace(/\u00a0/g, ' ').matchAll(/(\d[\d\s]*)\s*₽/g)]
    .map((m) => parsePrice(m[1]))
    .filter((n) => n >= 50);
}

function sanitizeOzonUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /\/category\//i.test(trimmed)) return null;

  // Prefer /product/… path (happy-dom may resolve relative href to localhost)
  let path = '';
  const pathMatch = trimmed.match(/\/product\/[^?#\s]+/i);
  if (pathMatch) {
    path = pathMatch[0];
  } else if (trimmed.startsWith('/')) {
    path = trimmed.split('?')[0].split('#')[0];
  } else {
    try {
      path = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }

  if (!path.includes('/product/')) return null;
  const raw = `https://www.ozon.ru${path.startsWith('/') ? path : `/${path}`}`;
  return isSafeMarketplaceUrl(raw, 'ozon') ? raw.split('#')[0].split('?')[0] : null;
}

/** Heuristic: challenge / access wall without product tiles. */
export function detectOzonAntibot(root: ParentNode, candidateCount: number): boolean {
  const text = (root.textContent ?? '').toLowerCase();
  const markers = [
    'captcha',
    'access denied',
    'доступ ограничен',
    'подтвердите, что вы не робот',
    'checking your browser',
    'cloudflare',
    'пожалуйста, подтвердите',
    'aborted',
  ];
  const hasMarker = markers.some((m) => text.includes(m));
  if (hasMarker && candidateCount === 0) return true;

  // Empty SERP shell: no product links after load, challenge iframe present
  const challenge =
    typeof (root as Document).querySelector === 'function' &&
    Boolean(
      (root as Document).querySelector(
        'iframe[src*="captcha"], iframe[src*="challenge"], #challenge-form, [id*="captcha" i]',
      ),
    );
  return challenge && candidateCount === 0;
}

/**
 * Parse Ozon search tiles from a Document / Element (unit-testable).
 * Price optional — tiles without price still become candidates.
 */
export function parseOzonSerpDomCandidates(
  root: ParentNode,
  query: string,
): OzonSerpDomCandidate[] {
  const doc = root as Document | Element;
  const linkSelectors = [
    'a[href*="/product/"]',
    '[data-widget="searchResultsV2"] a[href*="/product/"]',
    '[data-widget="tileGridDesktop"] a[href*="/product/"]',
    'div[data-index] a[href*="/product/"]',
  ];

  const linkSet = new Set<Element>();
  for (const selector of linkSelectors) {
    try {
      doc.querySelectorAll?.(selector).forEach((el) => linkSet.add(el));
    } catch {
      // ignore invalid selector in odd roots
    }
  }

  const results: OzonSerpDomCandidate[] = [];
  const seen = new Set<string>();

  for (const el of linkSet) {
    const link = el as HTMLAnchorElement;
    const href = link.getAttribute('href') || link.href || '';
    const safeUrl = sanitizeOzonUrl(href);
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(safeUrl);

    const container =
      link.closest('[data-index]') ??
      link.closest('[class*="tile-root"]') ??
      link.closest('article') ??
      link.parentElement?.parentElement?.parentElement;

    const containerText = container?.textContent ?? link.textContent ?? '';
    const title = pickSerpTitleFromTile({
      linkTitle: link.getAttribute('title'),
      ariaLabel: link.getAttribute('aria-label'),
      headline: container?.querySelector('[class*="tsBody"], [class*="tsHeadline"]')?.textContent?.trim(),
      linkText: link.textContent?.trim(),
      containerText,
      fallback: query,
      url: safeUrl,
    });
    const prices = parseRubPrices(containerText);
    const uniquePrices = [...new Set(prices)].sort((a, b) => a - b);
    const price = uniquePrices[0] ?? null;
    const oldPrice =
      uniquePrices.length > 1 ? uniquePrices[uniquePrices.length - 1] : undefined;
    const { rating, reviewCount } = parseRatingFromMarketplaceText(containerText);

    results.push({
      title: title.slice(0, 200),
      url: safeUrl,
      price,
      oldPrice: oldPrice && price != null && oldPrice > price ? oldPrice : undefined,
      rating,
      reviewCount,
    });
  }

  return results;
}

export function scanOzonSerpDom(root: ParentNode, query: string): OzonSerpDomScan {
  const candidates = parseOzonSerpDomCandidates(root, query);
  return {
    antibot: detectOzonAntibot(root, candidates.length),
    candidates,
  };
}

/** Self-contained DOM scan for chrome.scripting.executeScript (no imports). */
export function ozonSerpDomScanInPage(query: string): OzonSerpDomScan {
  const parsePrices = (text: string): number[] =>
    [...text.replace(/\u00a0/g, ' ').matchAll(/(\d[\d\s]*)\s*₽/g)]
      .map((m) => Number(String(m[1]).replace(/\s/g, '')))
      .filter((n) => Number.isFinite(n) && n >= 50);

  const isPromoSerpTitle = (title: string | null | undefined): boolean => {
    const t = title?.trim() ?? '';
    if (!t) return true;
    if (/^\d+\s*балл/i.test(t)) return true;
    if (/^(?:распрод(?:ажа)?|рекомен(?:дуем)?|осталось\s+\d+\s*шт\.?|хит|новинка|вы\s*год\s*выбираете)$/i.test(t)) {
      return true;
    }
    if (/^осталось\s+\d+/i.test(t)) return true;
    if (/^распрод/i.test(t) && t.length < 32) return true;
    if (/^рекомен/i.test(t) && t.length < 32) return true;
    if (
      /^\d+\s*балл|баллов|скидк|доставк|завтра|рассроч|кэшбэк|купон|акци|распрод|осталось\s*\d|рекомен|хит\b|новинк|выбор\s+покупател|^\d+\s*шт\.?\s*$/i.test(
        t,
      ) &&
      t.length < 48 &&
      !/\b(?:canon|nikon|sony|fuji|eos|iphone|samsung|nike|adidas|xiaomi|redmi|trace)\b/i.test(t)
    ) {
      return true;
    }
    if (t.length < 6 && !/[a-zа-яё]{4,}/i.test(t)) return true;
    if (t.length < 24 && !/\s/.test(t) && /^(?:распрод|рекомен|хит|новин)/i.test(t)) return true;
    return false;
  };

  const titleFromProductUrl = (url: string | null | undefined): string | null => {
    if (!url?.trim()) return null;
    const slugMatch = url.match(/\/product\/([^/?#]+)/i);
    if (!slugMatch?.[1]) return null;
    const slug = slugMatch[1].replace(/-\d{5,}$/i, '');
    const words = slug
      .split('-')
      .map((w) => w.trim())
      .filter((w) => w.length > 0 && !/^\d{5,}$/.test(w));
    if (words.length < 2) return null;
    const title = words
      .map((w) => (/^[a-z]{1,3}\d/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
    if (title.length < 8 || isPromoSerpTitle(title)) return null;
    return title.slice(0, 200);
  };

  const pickSerpTitleInPage = (opts: {
    linkTitle?: string | null;
    ariaLabel?: string | null;
    headline?: string | null;
    linkText?: string | null;
    containerText?: string | null;
    fallback: string;
    url?: string | null;
  }): string => {
    const candidates = [opts.headline, opts.linkTitle, opts.ariaLabel, opts.linkText].filter(
      (c): c is string => Boolean(c?.trim()),
    );
    for (const c of candidates) {
      if (!isPromoSerpTitle(c)) return c.trim().slice(0, 200);
    }
    const trimmed = (opts.linkText ?? opts.fallback).trim();
    if (trimmed && !isPromoSerpTitle(trimmed)) return trimmed.slice(0, 200);
    if (opts.containerText) {
      const lines = opts.containerText
        .split(/[\n|•]/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 8 && !isPromoSerpTitle(l));
      const best = lines.sort((a, b) => b.length - a.length)[0];
      if (best) return best.slice(0, 200);
    }
    const fromUrl = titleFromProductUrl(opts.url ?? undefined);
    if (fromUrl) return fromUrl;
    if (!trimmed || isPromoSerpTitle(trimmed)) return 'Товар на Ozon';
    return trimmed.slice(0, 200);
  };

  const sanitize = (href: string): string | null => {
    const t = href.trim();
    if (!t || /\/category\//i.test(t)) return null;
    let raw = t;
    if (t.startsWith('//')) raw = `https:${t}`;
    else if (t.startsWith('/')) raw = `https://www.ozon.ru${t}`;
    else if (!t.startsWith('http')) raw = `https://www.ozon.ru/${t}`;
    if (!/ozon\.ru\/product\//i.test(raw)) return null;
    try {
      const u = new URL(raw);
      return `${u.origin}${u.pathname}`.replace(/\/$/, '') + '/';
    } catch {
      return null;
    }
  };

  const selectors = [
    'a[href*="/product/"]',
    '[data-widget="searchResultsV2"] a[href*="/product/"]',
    '[data-widget="tileGridDesktop"] a[href*="/product/"]',
    'div[data-index] a[href*="/product/"]',
  ];
  const linkSet = new Set<HTMLAnchorElement>();
  for (const sel of selectors) {
    document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => linkSet.add(a));
  }

  const candidates: OzonSerpDomCandidate[] = [];
  const seen = new Set<string>();
  for (const link of linkSet) {
    const safeUrl = sanitize(link.href || link.getAttribute('href') || '');
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(safeUrl);
    const container =
      link.closest('[data-index]') ??
      link.closest('[class*="tile-root"]') ??
      link.closest('article') ??
      link.parentElement?.parentElement?.parentElement;
    const containerText = container?.textContent ?? link.textContent ?? '';
    const title = pickSerpTitleInPage({
      linkTitle: link.getAttribute('title'),
      ariaLabel: link.getAttribute('aria-label'),
      headline: container
        ?.querySelector('[class*="tsBody"], [class*="tsHeadline"]')
        ?.textContent?.trim(),
      linkText: link.textContent?.trim(),
      containerText,
      fallback: query,
      url: safeUrl,
    });
    const prices = parsePrices(containerText);
    const unique = [...new Set(prices)].sort((a, b) => a - b);
    const price = unique[0] ?? null;
    const oldPrice = unique.length > 1 ? unique[unique.length - 1] : undefined;
    const tileText = (container?.textContent ?? link.textContent ?? '').replace(/\u00a0/g, ' ');
    const ratingMatch =
      tileText.match(/(\d+[.,]\d+)\s*(?:из\s*5|★|⭐)/i) ??
      tileText.match(/рейтинг[:\s]*(\d+[.,]\d+)/i);
    let rating: number | null = null;
    if (ratingMatch?.[1]) {
      const n = parseFloat(ratingMatch[1].replace(',', '.'));
      if (Number.isFinite(n) && n >= 1 && n <= 5) rating = Math.round(n * 10) / 10;
    }
    const reviewMatch =
      tileText.match(/(\d[\d\s]*)\s*отзыв/i) ?? tileText.match(/(\d[\d\s]*)\s*оцен/i);
    const reviewRaw = reviewMatch
      ? Number.parseInt(reviewMatch[1].replace(/\s/g, ''), 10)
      : undefined;
    const reviewCount = reviewRaw && reviewRaw > 0 ? reviewRaw : undefined;
    candidates.push({
      title: title.slice(0, 200),
      url: safeUrl,
      price,
      oldPrice: oldPrice && price != null && oldPrice > price ? oldPrice : undefined,
      rating,
      reviewCount,
    });
  }

  const bodyText = (document.body?.innerText ?? document.body?.textContent ?? '').toLowerCase();
  const markers = [
    'captcha',
    'access denied',
    'доступ ограничен',
    'подтвердите, что вы не робот',
    'checking your browser',
    'cloudflare',
  ];
  const challengeEl = Boolean(
    document.querySelector(
      'iframe[src*="captcha"], iframe[src*="challenge"], #challenge-form, [id*="captcha" i]',
    ),
  );
  const antibot =
    candidates.length === 0 &&
    (challengeEl || markers.some((m) => bodyText.includes(m)));

  return { antibot, candidates };
}

export async function scrapeOzonSerpDomInTab(
  tabId: number,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  excludedUrls?: string[],
): Promise<MarketplaceOffer | null> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const searchUrl = buildMarketplaceSearchUrl('ozon', query);

  let scan: OzonSerpDomScan | null = null;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: ozonSerpDomScanInPage,
      args: [query],
    });
    scan = (result as OzonSerpDomScan | null) ?? null;
  } catch {
    return null;
  }

  if (!scan) return null;

  if (scan.antibot) {
    return {
      marketplace: 'ozon',
      title: query,
      price: null,
      delivery: null,
      rating: null,
      url: searchUrl,
      found: false,
      error: OZON_ANTIBOT_USER_MESSAGE,
    };
  }

  const offers: MarketplaceOffer[] = scan.candidates
    .filter((c) => c.url && !isUrlExcluded(c.url, excludedUrls))
    .map((c) => ({
      marketplace: 'ozon' as const,
      title: sanitizeCandidateTitle(c.title, undefined, c.url),
      price: c.price,
      oldPrice: c.oldPrice,
      delivery: null,
      rating: c.rating ?? null,
      reviewCount: c.reviewCount,
      url: c.url,
      found: Boolean(c.price && c.price > 0),
    }));

  if (!offers.length) return null;

  const ozonGetTitle = (o: MarketplaceOffer) => o.title;
  const ozonPickBase = {
    referencePrice,
    excludedUrls,
    getPrice: (o: unknown) => (o as MarketplaceOffer).price,
    getUrl: (o: unknown) => (o as MarketplaceOffer).url,
  };
  const ozonPickOpts = await attachPickHistoryBoosts(
    ref,
    'ozon',
    offers,
    ozonPickBase,
    ozonGetTitle,
  );

  const top = pickTopMatchesWithScore(ref, offers, ozonGetTitle, {
    ...ozonPickOpts,
    limit: MAX_CANDIDATE_POOL,
  });

  if (!top.length) {
    // Still surface candidates for manual pick
    const ranked = offers.slice(0, MAX_CANDIDATE_POOL).map((offer) => ({
      offer,
      confidence: 50,
    }));
    return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked);
  }

  const ranked = top.map(({ item, score }) => ({
    offer: item,
    confidence: matchConfidencePercent(score),
  }));

  return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked);
}

export function errorSuggestsVpnHint(error: string): boolean {
  return /лимит запросов|временно недоступ|ограничивает|403|429|antibot|captcha|доступ ограничен|blocked|rate.?limit/i.test(
    error,
  );
}
