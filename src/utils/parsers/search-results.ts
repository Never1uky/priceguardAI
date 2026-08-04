import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import {
  MIN_COMPARE_MATCH_CONFIDENCE,
  isProductPageUrl,
  pickBestMatchWithFallbackScored,
  pickTopMatchesWithScore,
} from '@/lib/product-match';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import {
  computeCandidatePriority,
  hasLargePriceSpreadAmongClose,
  pickCheapestAmongCloseMatches,
} from '@/lib/match-status';
import { parsePrice } from '@/utils/dom';
import { normalizeMarketplaceRating, parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { isSafeMarketplaceUrl } from '@/utils/safe-marketplace-url';
import { pickSerpTitleFromTile } from '@/lib/serp-title';
import { buildWbImageUrl, buildWbImageUrlAlternatives } from '@/utils/wb-image';
import type { Marketplace } from '@/types/product';

function marketplaceOrigin(marketplace: ComparisonMarketplace): string {
  switch (marketplace) {
    case 'wildberries':
      return 'https://www.wildberries.ru';
    case 'ozon':
      return 'https://www.ozon.ru';
    case 'yandex_market':
      return 'https://market.yandex.ru';
  }
}

function sanitizeCandidateUrl(
  href: string,
  marketplace: ComparisonMarketplace,
): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  let raw: string;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    raw = trimmed;
  } else if (trimmed.startsWith('//')) {
    raw = `https:${trimmed}`;
  } else {
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    raw = `${marketplaceOrigin(marketplace)}${path}`;
  }

  const mp = marketplace as Marketplace;
  return isSafeMarketplaceUrl(raw, mp) ? raw.split('#')[0] : null;
}

export interface SearchCandidate {
  title: string;
  url: string;
  price: number | null;
  oldPrice?: number;
  rating: number | null;
  reviewCount?: number;
  imageUrl?: string;
  imageUrlAlternatives?: string[];
}

export interface SearchPickResult {
  offer: MarketplaceOffer;
  ranked: Array<{
    candidate: SearchCandidate;
    confidence: number;
    score: number;
    priority?: number;
  }>;
}

export interface SearchPickOptions {
  referencePrice?: number;
  referenceSpecs?: string;
  excludedUrls?: string[];
}

function parseRubPrices(text: string): number[] {
  return [...text.replace(/\u00a0/g, ' ').matchAll(/(\d[\d\s]*)\s*₽/g)]
    .map((m) => parsePrice(m[1]))
    .filter((n) => n >= 50);
}

/** Prefer sale/current price (min), not crossed-out max on the card. */
export function pickWbDisplayPrice(prices: number[], oldPrice?: number | null): number | null {
  if (!prices.length) return null;
  const withoutOld = oldPrice ? prices.filter((p) => p < oldPrice * 0.98) : prices;
  const pool = withoutOld.length ? withoutOld : prices;
  return Math.min(...pool);
}

function parseRubPrice(text: string): number | null {
  const prices = parseRubPrices(text);
  return prices[0] ?? null;
}

function parseOzonRating(text: string): { rating: number | null; reviewCount?: number } {
  return parseRatingFromMarketplaceText(text);
}

function candidateToOffer(
  marketplace: ComparisonMarketplace,
  candidate: SearchCandidate,
  matchConfidence?: number,
  extras?: Partial<MarketplaceOffer>,
): MarketplaceOffer {
  return {
    marketplace,
    title: candidate.title,
    price: candidate.price,
    oldPrice: candidate.oldPrice,
    delivery: null,
    rating: normalizeMarketplaceRating(candidate.rating),
    reviewCount: candidate.reviewCount,
    url: candidate.url,
    imageUrl: candidate.imageUrl,
    imageUrlAlternatives: candidate.imageUrlAlternatives,
    found: Boolean(candidate.price && candidate.price > 0),
    matchConfidence,
    ...extras,
  };
}

function candidateToSearchCandidateOffer(
  candidate: SearchCandidate,
  confidence: number,
  referencePrice?: number,
): SearchCandidateOffer {
  const rating = normalizeMarketplaceRating(candidate.rating);
  const priority = computeCandidatePriority({
    match: confidence,
    price: candidate.price,
    referencePrice,
    rating,
    hasProductUrl: Boolean(candidate.url),
  });
  return {
    title: candidate.title,
    url: candidate.url,
    price: candidate.price,
    matchConfidence: confidence,
    priority,
    imageUrl: candidate.imageUrl,
    imageUrlAlternatives: candidate.imageUrlAlternatives,
    rating,
  };
}

/** Ранжирование кандидатов: match + priority (цена/рейтинг) */
export function rankSearchCandidates(
  referenceTitle: string,
  candidates: SearchCandidate[],
  options: SearchPickOptions = {},
): Array<{ candidate: SearchCandidate; confidence: number; score: number; priority: number }> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : '';

  const top = pickTopMatchesWithScore(ref, candidates, (c) => c.title, {
    referencePrice: options.referencePrice,
    referenceSpecs: options.referenceSpecs,
    excludedUrls: options.excludedUrls,
    minScore: 0.38,
    maxPriceRatio: 1.5,
    getPrice: (c) => (c as SearchCandidate).price,
    getUrl: (c) => (c as SearchCandidate).url,
    limit: 10,
  });

  const scored = top.map(({ item, score }) => {
    const confidence = matchConfidencePercent(score);
    const priority = computeCandidatePriority({
      match: confidence,
      price: item.price,
      referencePrice: options.referencePrice,
      rating: item.rating,
      hasProductUrl: Boolean(item.url),
    });
    return { candidate: item, confidence, score, priority };
  });

  return scored.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const pa = a.candidate.price ?? Number.POSITIVE_INFINITY;
    const pb = b.candidate.price ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

/** Выбор из выдачи: только пул карточек для cascade — без SERP found:true */
export function pickSearchFromCandidates(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  candidates: SearchCandidate[],
  options: SearchPickOptions = {},
): SearchPickResult {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;

  if (!candidates.length) {
    return {
      offer: {
        ...buildSearchNotFoundOffer(marketplace, query, 'Не удалось определить товар'),
        matchStatus: 'not_found',
      },
      ranked: [],
    };
  }

  const rankedRaw = rankSearchCandidates(ref, candidates, options);
  const ranked = pickCheapestAmongCloseMatches(
    rankedRaw.map((r) => ({ ...r, price: r.candidate.price })),
  );
  const forceChoice = hasLargePriceSpreadAmongClose(ranked);
  const top3 = ranked.slice(0, 3).filter((r) => {
    const url = r.candidate.url;
    return Boolean(url && isProductPageUrl(url));
  });
  const searchCandidates = top3.map(({ candidate, confidence }) =>
    candidateToSearchCandidateOffer(candidate, confidence, options.referencePrice),
  );

  if (!searchCandidates.length) {
    return {
      offer: {
        ...buildSearchNotFoundOffer(
          marketplace,
          query,
          'В выдаче нет ссылок на карточки товаров',
        ),
        matchStatus: 'not_found',
      },
      ranked: [],
    };
  }

  const best = top3[0]!;
  const shellUrl = buildMarketplaceSearchUrl(marketplace, query);
  const shellRating =
    searchCandidates.length === 1
      ? normalizeMarketplaceRating(searchCandidates[0]!.rating)
      : null;

  return {
    offer: {
      marketplace,
      title: best.candidate.title,
      price: null,
      delivery: null,
      rating: shellRating,
      reviewCount:
        searchCandidates.length === 1 ? best.candidate.reviewCount : undefined,
      url: shellUrl,
      found: false,
      matchConfidence: best.confidence,
      matchStatus: 'needs_choice',
      searchCandidates,
      needsManualPick: true,
      error:
        searchCandidates.length > 1
          ? forceChoice
            ? `Цены сильно отличаются — выберите нужный из ${searchCandidates.length}`
            : `Есть ${searchCandidates.length} похожих варианта — проверяем карточки`
          : 'Проверяем карточку товара',
    },
    ranked: top3,
  };
}

function wbCardFromElement(card: Element, query: string): SearchCandidate | null {
  const link = card.querySelector('a[href*="/catalog/"]') as HTMLAnchorElement | null;
  const href = link?.href ?? '';
  const nmId =
    card.getAttribute('data-nm-id') ??
    href.match(/\/catalog\/(\d+)/i)?.[1] ??
    card.querySelector('[data-nm-id]')?.getAttribute('data-nm-id');

  if (!nmId || nmId === '0') return null;

  const titleEl =
    card.querySelector(
      '[class*="product-card__name"], [class*="goods-name"], .product-card__name, [class*="name"]',
    ) ?? link;

  const title = titleEl?.textContent?.trim() ?? link?.title?.trim() ?? query;

  const oldPriceEl = card.querySelector('[class*="price__old"], del, s, [class*="old-price"]');
  const oldPrice = oldPriceEl?.textContent ? parseRubPrice(oldPriceEl.textContent) : null;

  const prices = parseRubPrices(card.textContent ?? '');
  const price = pickWbDisplayPrice(prices, oldPrice);
  if (!price) return null;

  const ratingText = card.textContent ?? '';
  const ratingMatch =
    ratingText.match(/(\d+[.,]\d+)\s*(?:★|⭐|из)/) ??
    ratingText.match(/рейтинг[:\s]*(\d+[.,]\d+)/i);
  const rating = normalizeMarketplaceRating(
    ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null,
  );

  const reviewMatch = ratingText.match(/(\d[\d\s]*)\s*оцен/i);
  const reviewCount = reviewMatch ? parsePrice(reviewMatch[1]) : undefined;

  const urlRaw = href.includes('detail')
    ? href.split('?')[0]
    : `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`;
  const url = sanitizeCandidateUrl(urlRaw, 'wildberries');
  if (!url) return null;

  const imageUrl = buildWbImageUrl(nmId);
  const imageUrlAlternatives = buildWbImageUrlAlternatives(nmId).filter((u) => u !== imageUrl);

  return {
    title,
    url,
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
    rating,
    reviewCount,
    imageUrl,
    imageUrlAlternatives,
  };
}

/** Парсинг выдачи WB из DOM (тестируется через DOMParser / content script) */
export function parseWildberriesCandidatesFromRoot(root: ParentNode, query: string): SearchCandidate[] {
  const cardSelectors = [
    'article.product-card',
    '.product-card',
    '.product-card-list__item',
    '.product-card__wrapper',
    '[data-nm-id]',
    '.product-card__link',
  ];

  const cardSet = new Set<Element>();
  for (const sel of cardSelectors) {
    root.querySelectorAll(sel).forEach((el) => {
      const card = el.closest('[data-nm-id]') ?? el.closest('article') ?? el;
      cardSet.add(card);
    });
  }

  const results: SearchCandidate[] = [];
  const seen = new Set<string>();

  for (const card of cardSet) {
    const candidate = wbCardFromElement(card, query);
    if (!candidate?.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    results.push(candidate);
  }

  return results;
}

function scrapeWildberriesCandidates(query: string): SearchCandidate[] {
  return parseWildberriesCandidatesFromRoot(document, query);
}

function scrapeOzonCandidates(query: string): SearchCandidate[] {
  const linkSelectors = [
    'a[href*="/product/"]',
    '[data-widget="searchResultsV2"] a[href*="/product/"]',
    '[data-widget="tileGridDesktop"] a[href*="/product/"]',
    'div[data-index] a[href*="/product/"]',
  ];

  const linkSet = new Set<HTMLAnchorElement>();
  for (const selector of linkSelectors) {
    document.querySelectorAll<HTMLAnchorElement>(selector).forEach((el) => linkSet.add(el));
  }

  const results: SearchCandidate[] = [];
  const seen = new Set<string>();

  for (const link of linkSet) {
    const href = link.href;
    if (!href.includes('/product/') || seen.has(href) || /\/category\//i.test(href)) continue;
    const safeUrl = sanitizeCandidateUrl(
      href.startsWith('http') ? href : `https://www.ozon.ru${href.startsWith('/') ? href : `/${href}`}`,
      'ozon',
    );
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(href);
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
    });
    const prices = parseRubPrices(containerText);
    if (!prices.length) continue;

    // Актуальная (меньшая) цена — скидка; max часто старая
    const uniquePrices = [...new Set(prices)].sort((a, b) => a - b);
    const price = uniquePrices[0];
    const oldPrice = uniquePrices.length > 1 ? uniquePrices[uniquePrices.length - 1] : undefined;
    const { rating, reviewCount } = parseOzonRating(containerText);

    results.push({
      title: title.slice(0, 200),
      url: safeUrl,
      price,
      oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
      rating,
      reviewCount,
    });
  }

  return results;
}

function scrapeYandexMarketCandidates(query: string): SearchCandidate[] {
  const snippets = document.querySelectorAll(
    [
      '[data-zone-name="productSnippet"]',
      '[data-zone-name="snippet"]',
      '[data-auto="snippet"]',
      '[data-autotest-id="product-snippet"]',
      '[data-baobab-name="product"]',
      'article[data-auto="searchOrganic"]',
    ].join(', '),
  );

  const items = snippets.length ? snippets : document.querySelectorAll('article');

  const results: SearchCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const link = item.querySelector<HTMLAnchorElement>(
      'a[href*="/card/"], a[href*="/product/"], a[href*="market.yandex"]',
    );
    if (!link?.href || seen.has(link.href) || link.href.includes('/search')) continue;

    let url = link.href;
    if (!url.startsWith('http')) url = `https://market.yandex.ru${url}`;
    const safeUrl = sanitizeCandidateUrl(url, 'yandex_market');
    if (!safeUrl || seen.has(safeUrl)) continue;
    seen.add(link.href);
    seen.add(safeUrl);

    const title =
      item.querySelector('[data-auto="snippet-title"], [data-zone-name="title"], h3')?.textContent?.trim() ||
      link.getAttribute('aria-label')?.trim() ||
      link.textContent?.trim() ||
      query;

    const text = item.textContent ?? '';
    const prices = parseRubPrices(text);
    if (!prices.length) continue;

    const price = Math.min(...prices);
    const ratingMatch = text.match(/(\d[.,]\d)\s*(?:из\s*5|★|⭐)/i);
    const rating = normalizeMarketplaceRating(
      ratingMatch ? ratingMatch[1].replace(',', '.') : null,
    );

    results.push({
      title: title.slice(0, 200),
      url: safeUrl,
      price,
      rating,
      reviewCount: undefined,
    });
  }

  return results;
}

export function scrapeAllCandidates(marketplace: ComparisonMarketplace, query: string): SearchCandidate[] {
  switch (marketplace) {
    case 'wildberries':
      return scrapeWildberriesCandidates(query);
    case 'ozon':
      return scrapeOzonCandidates(query);
    case 'yandex_market':
      return scrapeYandexMarketCandidates(query);
  }
}

export function pickBestSearchCandidate(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  referenceSpecs?: string,
): MarketplaceOffer | null {
  const candidates = scrapeAllCandidates(marketplace, query);
  if (!candidates.length) return null;

  const result = pickSearchFromCandidates(marketplace, query, referenceTitle, candidates, {
    referencePrice,
    referenceSpecs,
  });

  if (result.offer.found || result.offer.needsManualPick) return result.offer;

  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const match = pickBestMatchWithFallbackScored(ref, candidates, (c) => c.title, {
    referencePrice,
    referenceSpecs,
    minScore: 0.42,
    maxPriceRatio: 1.5,
    getPrice: (c) => (c as SearchCandidate).price,
    getUrl: (c) => (c as SearchCandidate).url,
  });

  if (match && matchConfidencePercent(match.score) >= MIN_COMPARE_MATCH_CONFIDENCE) {
    return candidateToOffer(marketplace, match.item, matchConfidencePercent(match.score));
  }

  return null;
}

export function scrapeMarketplaceSearch(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle?: string,
  referencePrice?: number,
  referenceSpecs?: string,
  excludedUrls?: string[],
): MarketplaceOffer | null {
  const candidates = scrapeAllCandidates(marketplace, query);
  if (!candidates.length) return null;

  return pickSearchFromCandidates(
    marketplace,
    query,
    referenceTitle ?? query,
    candidates,
    { referencePrice, referenceSpecs, excludedUrls },
  ).offer;
}

export function buildSearchNotFoundOffer(
  marketplace: ComparisonMarketplace,
  query: string,
  error?: string,
): MarketplaceOffer {
  return {
    marketplace,
    title: query,
    price: null,
    delivery: null,
    rating: null,
    url: buildMarketplaceSearchUrl(marketplace, query),
    found: false,
    error: error ?? 'Товар не найден в выдаче',
  };
}

/** Парсинг HTML-фикстуры WB SERP (для тестов с DOMParser) */
export function parseWildberriesSerpHtml(html: string, query: string): SearchCandidate[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseWildberriesCandidatesFromRoot(doc, query);
}
