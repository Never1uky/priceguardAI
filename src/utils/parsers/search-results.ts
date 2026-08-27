import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import {
  buildMarketplaceSearchUrl,
  extractComparisonArticle,
  marketplaceOrigin,
} from '@/utils/comparison-url';
import { parseImageFromDomRoot, normalizeImageCandidate } from '@/utils/parsers/generic-mp-card';
import {
  getTabSearchAdapter,
  isGenericCardMarketplace,
} from '@/lib/marketplaces/adapter-config';
import {
  MIN_COMPARE_MATCH_CONFIDENCE,
  isProductPageUrl,
  pickBestMatchWithFallbackScored,
  pickTopMatchesWithScore,
  scoreProductMatch,
} from '@/lib/product-match';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import {
  computeCandidatePriority,
  hasLargePriceSpreadAmongClose,
  reorderPickerCandidates,
} from '@/lib/match-status';
import { isTitleCategoryCompatible } from '@/lib/match-category';
import { areLineageGenerationsCompatible } from '@/lib/lineage-generation';
import { tryUnambiguousSerpVerified } from '@/lib/serp-auto-pick';
import { parsePrice } from '@/utils/dom';
import { parseListingRubNumbers } from '@/lib/listing-rub-prices';
import { normalizeMarketplaceRating, parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { isSafeMarketplaceUrl } from '@/utils/safe-marketplace-url';
import { isPlaceholderSerpTitle, pickSerpTitleFromTile } from '@/lib/serp-title';
import { buildWbImageUrl, buildWbImageUrlAlternatives } from '@/utils/wb-image';
import type { Marketplace } from '@/types/product';
import { isIdentityExcluded } from '@/lib/offer-identity';
import { toCanonicalProductUrl } from '@/utils/product-url';
/** Dedupe by product article; keep the cheaper SERP price (YM "from" vs default offer). */
function upsertSerpCandidate(
  results: SearchCandidate[],
  seenIndex: Map<string, number>,
  candidate: SearchCandidate,
  marketplace: ComparisonMarketplace,
): void {
  const article = extractComparisonArticle(candidate.url, marketplace);
  const key = (article || candidate.url).toLowerCase();
  const existingIdx = seenIndex.get(key);
  if (existingIdx != null) {
    const prev = results[existingIdx]!;
    if (
      candidate.price != null &&
      candidate.price > 0 &&
      (prev.price == null || candidate.price < prev.price)
    ) {
      results[existingIdx] = {
        ...prev,
        price: candidate.price,
        title: candidate.title || prev.title,
        rating: candidate.rating ?? prev.rating,
        imageUrl: candidate.imageUrl ?? prev.imageUrl,
      };
    }
    return;
  }
  seenIndex.set(key, results.length);
  results.push(candidate);
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
  /** Rejected identity fingerprints (line+gen / article) — stronger than URL-only. */
  excludedFingerprints?: string[];
  marketplace?: ComparisonMarketplace;
  /** Override rank floor. Visible tiles below default 0.38 still become needs_choice. */
  minScore?: number;
}

function parseRubPrices(text: string): number[] {
  const normalized = text.replace(/\u00a0/g, ' ');
  // Thousands groups or ≥3 digits — avoid "Pixel 7 24 682 ₽" → 724682
  return [...normalized.matchAll(/(?<!\d)(\d{1,3}(?:\s\d{3})+|\d{3,})\s*₽/g)]
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

  const filtered = candidates.filter((c) => {
    if (ref && !areLineageGenerationsCompatible(ref, c.title)) {
      return false;
    }
    if (
      options.excludedFingerprints?.length &&
      isIdentityExcluded(c.title, c.url, options.marketplace, options.excludedFingerprints)
    ) {
      return false;
    }
    return true;
  });

  const top = pickTopMatchesWithScore(ref, filtered, (c) => c.title, {
    referencePrice: options.referencePrice,
    referenceSpecs: options.referenceSpecs,
    excludedUrls: options.excludedUrls,
    minScore: options.minScore ?? 0.38,
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

/** Выбор из выдачи: однозначный top-1 → verified; иначе пул для cascade / picker */
export function pickSearchFromCandidates(
  marketplace: ComparisonMarketplace,
  query: string,
  referenceTitle: string,
  candidates: SearchCandidate[],
  options: SearchPickOptions = {},
): SearchPickResult {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const pickOpts: SearchPickOptions = { ...options, marketplace };

  if (!candidates.length) {
    return {
      offer: {
        ...buildSearchNotFoundOffer(marketplace, query, 'Не удалось определить товар'),
        matchStatus: 'not_found',
      },
      ranked: [],
    };
  }

  const hardOk = candidates.filter(
    (c) =>
      areLineageGenerationsCompatible(ref, c.title) &&
      !isIdentityExcluded(c.title, c.url, marketplace, pickOpts.excludedFingerprints),
  );

  let rankedRaw = rankSearchCandidates(ref, hardOk, pickOpts);
  if (!rankedRaw.length) {
    rankedRaw = rankSearchCandidates(ref, hardOk, {
      ...pickOpts,
      minScore: 0,
    });
  }
  if (!rankedRaw.length && hardOk.length) {
    rankedRaw = hardOk
      .filter((c) => c.url && isProductPageUrl(c.url))
      .filter((c) => isTitleCategoryCompatible(ref, c.title, pickOpts.referenceSpecs))
      .map((candidate) => {
        const score = scoreProductMatch(ref, candidate.title, pickOpts.referenceSpecs);
        const confidence = matchConfidencePercent(score);
        const priority = computeCandidatePriority({
          match: confidence,
          price: candidate.price,
          referencePrice: pickOpts.referencePrice,
          rating: candidate.rating,
          hasProductUrl: Boolean(candidate.url),
        });
        return { candidate, confidence, score, priority };
      })
      .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence)
      .slice(0, 3);
  }
  // No hard-compatible tiles → not_found (do not promote Gen3/Select via price)
  if (!rankedRaw.length) {
    return {
      offer: {
        ...buildSearchNotFoundOffer(
          marketplace,
          query,
          'Точного совпадения нет. Проверьте похожие варианты: название, цвет и память.',
        ),
        matchStatus: 'not_found',
      },
      ranked: [],
    };
  }

  // Mega + Ali: minScore:0 fallback otherwise promotes score===0 junk (furniture/food/wrong storage)
  // into needs_choice. CORE marketplaces keep the shared soft path unchanged.
  if (marketplace === 'megamarket' || marketplace === 'aliexpress') {
    rankedRaw = rankedRaw.filter((r) => {
      const title = r.candidate.title ?? '';
      if (!isTitleCategoryCompatible(ref, title, pickOpts.referenceSpecs)) return false;
      return scoreProductMatch(ref, title, pickOpts.referenceSpecs) > 0;
    });
    if (!rankedRaw.length) {
      return {
        offer: {
          ...buildSearchNotFoundOffer(
            marketplace,
            query,
            'Точного совпадения нет. Проверьте похожие варианты: название, цвет и память.',
          ),
          matchStatus: 'not_found',
        },
        ranked: [],
      };
    }
  }

  const ranked = reorderPickerCandidates(
    rankedRaw,
    ref,
    (r) => r.candidate.title ?? '',
    (r) => r.confidence,
    (r) => r.candidate.price,
    pickOpts.referenceSpecs,
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

  const unambiguous = tryUnambiguousSerpVerified(
    marketplace,
    top3.map((r) => ({
      title: r.candidate.title,
      url: r.candidate.url,
      price: r.candidate.price,
      confidence: r.confidence,
      imageUrl: r.candidate.imageUrl,
      rating: r.candidate.rating,
    })),
  );
  if (unambiguous) {
    return { offer: unambiguous, ranked: top3 };
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

  const priceNodes = card.querySelectorAll(
    '[class*="price__lower"], [class*="price__current"], ins[class*="price"], .price__wrap',
  );
  const fromNodes = [...priceNodes].flatMap((el) => parseRubPrices(el.textContent ?? ''));
  const prices = fromNodes.length ? fromNodes : parseRubPrices(card.textContent ?? '');
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
  const seenIndex = new Map<string, number>();

  for (const card of cardSet) {
    const candidate = wbCardFromElement(card, query);
    if (!candidate?.url) continue;
    upsertSerpCandidate(results, seenIndex, candidate, 'wildberries');
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
  const seenIndex = new Map<string, number>();
  const seenHrefs = new Set<string>();

  for (const link of linkSet) {
    const href = link.href;
    if (!href.includes('/product/') || seenHrefs.has(href) || /\/category\//i.test(href)) continue;
    const safeUrl = sanitizeCandidateUrl(
      href.startsWith('http') ? href : `https://www.ozon.ru${href.startsWith('/') ? href : `/${href}`}`,
      'ozon',
    );
    if (!safeUrl) continue;
    seenHrefs.add(href);

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

    upsertSerpCandidate(
      results,
      seenIndex,
      {
        title: title.slice(0, 200),
        url: safeUrl,
        price,
        oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
        rating,
        reviewCount,
      },
      'ozon',
    );
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
      // Top price-comparison / gallery tiles on YM SERP
      '[data-zone-name="SearchPage"] [data-zone-name="productSnippet"]',
      '[data-apiary-widget-name="@card"]',
    ].join(', '),
  );

  const items = snippets.length ? snippets : document.querySelectorAll('article');

  const results: SearchCandidate[] = [];
  const seenIndex = new Map<string, number>();

  for (const item of items) {
    const link = item.querySelector<HTMLAnchorElement>(
      'a[href*="/card/"], a[href*="/product/"], a[href*="market.yandex"]',
    );
    if (!link?.href || link.href.includes('/search')) continue;

    let url = link.href;
    if (!url.startsWith('http')) url = `https://market.yandex.ru${url}`;
    const safeUrl = sanitizeCandidateUrl(url, 'yandex_market');
    if (!safeUrl) continue;

    const title =
      item.querySelector('[data-auto="snippet-title"], [data-zone-name="title"], h3')?.textContent?.trim() ||
      link.getAttribute('aria-label')?.trim() ||
      link.textContent?.trim() ||
      query;

    const text = item.textContent ?? '';
    const prices = parseRubPrices(text);
    if (!prices.length) continue;

    // Prefer the lowest visible price (SERP "from"); skip duty-only noise by taking min ≥ 500
    const pricePool = prices.filter((p) => p >= 500);
    const price = Math.min(...(pricePool.length ? pricePool : prices));
    const ratingMatch = text.match(/(\d[.,]\d)\s*(?:из\s*5|★|⭐)/i);
    const rating = normalizeMarketplaceRating(
      ratingMatch ? ratingMatch[1].replace(',', '.') : null,
    );

    upsertSerpCandidate(
      results,
      seenIndex,
      {
        title: title.slice(0, 200),
        url: safeUrl,
        price,
        rating,
        reviewCount: undefined,
      },
      'yandex_market',
    );
  }

  return results;
}

export function scrapeMegamarketCandidates(_query: string): SearchCandidate[] {
  const results: SearchCandidate[] = [];
  const seenIndex = new Map<string, number>();

  const pushFromTile = (hrefRaw: string, tile: HTMLElement) => {
    let href = hrefRaw;
    if (!/\/catalog\/details\//i.test(href) && /^\d{6,}$/.test(href.replace(/\D/g, ''))) {
      const id = href.replace(/\D/g, '');
      href = `https://megamarket.ru/catalog/details/${id}/`;
    }
    if (!/\/catalog\/details\//i.test(href)) return;

    const safeHref = sanitizeCandidateUrl(href, 'megamarket');
    if (!safeHref) return;
    const url = toCanonicalProductUrl(safeHref, 'megamarket');
    if (!/\/catalog\/details\//i.test(url)) return;
    if (!extractComparisonArticle(url, 'megamarket')) return;

    const title = pickSerpTitleFromTile({
      linkTitle: tile.getAttribute('title'),
      ariaLabel: tile.getAttribute('aria-label'),
      headline: tile.querySelector('h2, h3, [class*="title"], [class*="Title"]')?.textContent?.trim(),
      linkText: tile.matches?.('a') ? tile.textContent?.trim() : tile.querySelector('a')?.textContent?.trim(),
      containerText: tile.innerText?.slice(0, 800),
      fallback: '',
      url,
    });
    if (!title || title.length < 3 || isPlaceholderSerpTitle(title)) return;

    const priceText = tile.innerText?.slice(0, 500) ?? '';
    const priceNums = parseRubPrices(priceText);
    const pricePool = priceNums.filter((p) => p >= 50);
    const price = pricePool.length ? Math.min(...pricePool) : null;

    const img = tile.querySelector('img') as HTMLImageElement | null;

    upsertSerpCandidate(
      results,
      seenIndex,
      {
        title,
        url,
        price: price && price > 0 ? price : null,
        imageUrl: img?.src || undefined,
        rating: null,
        reviewCount: undefined,
      },
      'megamarket',
    );
  };

  const roots = document.querySelectorAll(
    'a[href*="/catalog/details/"], [data-product-id] a[href*="/catalog/details/"]',
  );
  for (const link of roots) {
    const hrefRaw = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
    if (!/\/catalog\/details\//i.test(hrefRaw)) continue;
    const tile =
      (link.closest('[data-product-id], [class*="product"], [class*="Product"], li, article') as
        | HTMLElement
        | null) ?? (link as HTMLElement);
    pushFromTile(hrefRaw, tile);
    if (results.length >= 24) return results;
  }

  // Tiles with data-product-id but no direct details link yet
  for (const node of document.querySelectorAll('[data-product-id], [data-goods-id]')) {
    if (results.length >= 24) break;
    const id =
      node.getAttribute('data-product-id') || node.getAttribute('data-goods-id') || '';
    if (!/^\d{6,}$/.test(id)) continue;
    const existingLink = node.querySelector('a[href*="/catalog/details/"]') as HTMLAnchorElement | null;
    const href =
      existingLink?.href ||
      existingLink?.getAttribute('href') ||
      `https://megamarket.ru/catalog/details/${id}/`;
    pushFromTile(href, node as HTMLElement);
  }

  return results;
}

export function scrapeGenericTabSearchCandidates(
  marketplace: ComparisonMarketplace,
  query: string,
): SearchCandidate[] {
  const cfg = getTabSearchAdapter(marketplace);
  if (!cfg || !isGenericCardMarketplace(marketplace)) return [];

  const results: SearchCandidate[] = [];
  const seenIndex = new Map<string, number>();
  const links = document.querySelectorAll('a[href]');

  for (const link of links) {
    const hrefRaw = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
    if (!cfg.serpProductHref.test(hrefRaw)) continue;
    const href = sanitizeCandidateUrl(hrefRaw, marketplace);
    if (!href) continue;
    if (!cfg.isProductPage(href)) continue;

    const tile =
      (link.closest('[data-product-id], [class*="product"], [class*="Product"], li, article') as
        | HTMLElement
        | null) ?? (link as HTMLElement);
    const title = pickSerpTitleFromTile({
      linkTitle: link.getAttribute('title'),
      ariaLabel: link.getAttribute('aria-label'),
      headline: tile.querySelector('h2, h3, [class*="title"], [class*="Title"]')?.textContent?.trim(),
      linkText: link.textContent?.trim(),
      containerText: tile.innerText?.slice(0, 800),
      fallback: query,
      url: href,
    });
    if (!title || title.length < 3) continue;

    const priceText = tile.innerText?.slice(0, 500) ?? '';
    const priceNums = priceText.match(/(\d[\d\s]*)\s*(?:₽|руб)/i);
    const price = priceNums
      ? parseInt(priceNums[1]!.replace(/\s/g, ''), 10)
      : parsePrice(priceText) || null;

    const img = tile.querySelector('img') as HTMLImageElement | null;
    const imageUrl =
      normalizeImageCandidate(img?.currentSrc || img?.src) ||
      normalizeImageCandidate(img?.getAttribute('data-src')) ||
      normalizeImageCandidate(img?.getAttribute('data-original')) ||
      parseImageFromDomRoot(tile) ||
      undefined;

    upsertSerpCandidate(
      results,
      seenIndex,
      {
        title,
        url: href.split('?')[0]!,
        price: price && price > 0 ? price : null,
        imageUrl,
        rating: null,
        reviewCount: undefined,
      },
      marketplace,
    );
    if (results.length >= 24) break;
  }

  return results;
}

/**
 * AliExpress wholesale / search SERP — only /item/{id} tiles (ALI-1).
 * Dedupes by article; canonical URL without query.
 */
export function scrapeAliExpressCandidates(query: string): SearchCandidate[] {
  const results: SearchCandidate[] = [];
  const seenIndex = new Map<string, number>();

  const pushFromTile = (hrefRaw: string, tile: HTMLElement) => {
    if (!/\/item\/\d{8,}/i.test(hrefRaw)) return;
    const href = sanitizeCandidateUrl(hrefRaw, 'aliexpress');
    if (!href) return;
    const url = toCanonicalProductUrl(href, 'aliexpress');
    if (!extractComparisonArticle(url, 'aliexpress')) return;

    const link = tile.matches('a[href]')
      ? (tile as HTMLAnchorElement)
      : (tile.querySelector('a[href*="/item/"]') as HTMLAnchorElement | null);

    const title = pickSerpTitleFromTile({
      linkTitle: link?.getAttribute('title'),
      ariaLabel: link?.getAttribute('aria-label') ?? tile.getAttribute('aria-label'),
      headline: tile
        .querySelector('h1, h2, h3, [class*="title" i], [class*="Title"]')
        ?.textContent?.trim(),
      linkText: link?.textContent?.trim(),
      containerText: tile.innerText?.slice(0, 800),
      fallback: query,
      url,
    });
    if (!title || title.length < 3) return;

    const priceText = tile.innerText?.slice(0, 500) ?? '';
    const priceNums = priceText.match(/(\d[\d\s]*)\s*(?:₽|руб|RUB)/i);
    let price: number | null = priceNums
      ? parseInt(priceNums[1]!.replace(/\s/g, ''), 10)
      : parsePrice(priceText) || null;
    if (price == null || !(price > 0)) {
      const listed = parseListingRubNumbers(priceText);
      price = listed[0] ?? null;
    }

    const img = tile.querySelector('img') as HTMLImageElement | null;
    const imageUrl =
      normalizeImageCandidate(img?.currentSrc || img?.src) ||
      normalizeImageCandidate(img?.getAttribute('data-src')) ||
      normalizeImageCandidate(img?.getAttribute('data-original')) ||
      parseImageFromDomRoot(tile) ||
      undefined;

    upsertSerpCandidate(
      results,
      seenIndex,
      {
        title,
        url,
        price: price && price > 0 ? price : null,
        imageUrl,
        rating: null,
        reviewCount: undefined,
      },
      'aliexpress',
    );
  };

  for (const link of document.querySelectorAll('a[href*="/item/"]')) {
    if (results.length >= 24) break;
    const hrefRaw = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
    const tile =
      (link.closest(
        '[data-product-id], [class*="product" i], [class*="Product"], [class*="search-item" i], li, article',
      ) as HTMLElement | null) ?? (link as HTMLElement);
    pushFromTile(hrefRaw, tile);
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
    case 'megamarket':
      return scrapeMegamarketCandidates(query);
    case 'aliexpress':
      return scrapeAliExpressCandidates(query);
    default:
      return scrapeGenericTabSearchCandidates(marketplace, query);
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
  excludedFingerprints?: string[],
): MarketplaceOffer | null {
  const candidates = scrapeAllCandidates(marketplace, query);
  if (!candidates.length) return null;

  return pickSearchFromCandidates(
    marketplace,
    query,
    referenceTitle ?? query,
    candidates,
    { referencePrice, referenceSpecs, excludedUrls, excludedFingerprints, marketplace },
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
