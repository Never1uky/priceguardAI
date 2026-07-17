import { isOfferWithPrice } from '@/lib/compare-offers';
import type { CompareProduct, ComparisonMarketplace } from '@/types/comparison';
import { normalizeCompareUrl } from '@/utils/comparison-url';

const ALL_MARKETPLACES: ComparisonMarketplace[] = [
  'wildberries',
  'ozon',
  'yandex_market',
];

const STOP_WORDS = new Set([
  'товар',
  'видеокарта',
  'смартфон',
  'ноутбук',
  'наушники',
  'для',
  'the',
  'and',
  'with',
  'гб',
  'шт',
  'new',
  'pro',
]);

export function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  if (!a || !b || a === 'Товар' || b === 'Товар') return 0;

  const wordsA = new Set(
    normalizeTitleForMatch(a)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
  const wordsB = new Set(
    normalizeTitleForMatch(b)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );

  if (!wordsA.size || !wordsB.size) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  return intersection / Math.max(wordsA.size, wordsB.size);
}

export function extractMatchTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  if (!title || title === 'Товар') return tokens;

  const norm = normalizeTitleForMatch(title);

  const rtx = norm.match(/rtx\s*(\d{3,4})/);
  if (rtx) tokens.add(`rtx${rtx[1]}`);

  const gtx = norm.match(/gtx\s*(\d{3,4})/);
  if (gtx) tokens.add(`gtx${gtx[1]}`);

  const modelCodes = norm.match(/[a-z]{1,4}-?[a-z]?\d{3,6}[a-z0-9]*/gi) ?? [];
  for (const code of modelCodes) {
    const clean = code.replace(/-/g, '').toLowerCase();
    if (clean.length >= 5) tokens.add(clean);
  }

  for (const word of norm.split(' ')) {
    if (word.length >= 4 && !STOP_WORDS.has(word)) {
      tokens.add(word);
    }
  }

  return tokens;
}

export function productTokenOverlapScore(a: string, b: string): number {
  if (!a || !b || a === 'Товар' || b === 'Товар') return 0;

  const ta = extractMatchTokens(a);
  const tb = extractMatchTokens(b);
  if (!ta.size || !tb.size) return 0;

  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection++;
  }

  if (intersection === 0) return 0;

  const rtxA = [...ta].find((t) => t.startsWith('rtx'));
  const rtxB = [...tb].find((t) => t.startsWith('rtx'));
  if (rtxA && rtxB && rtxA === rtxB && intersection >= 2) {
    return Math.max(0.55, intersection / Math.min(ta.size, tb.size));
  }

  return intersection / Math.max(ta.size, tb.size);
}

export function getBestTitle(product: CompareProduct): string {
  if (product.title && product.title !== 'Товар') {
    return product.title;
  }

  for (const offer of Object.values(product.marketplaceOffers ?? {})) {
    if (offer?.title && offer.title !== 'Товар') {
      return offer.title;
    }
  }

  return product.title;
}

export function countLinkedMarketplaces(product: CompareProduct): number {
  return ALL_MARKETPLACES.filter((mp) => Boolean(getMarketplaceUrl(product, mp))).length;
}

export function getMarketplaceUrl(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string | undefined {
  const raw =
    product.marketplaceUrls[marketplace] ??
    (product.sourceMarketplace === marketplace ? product.sourceUrl : undefined);
  return raw ? normalizeCompareUrl(raw) : undefined;
}

export function collectProductUrls(product: CompareProduct): string[] {
  const urls = new Set<string>();
  if (product.sourceUrl) urls.add(normalizeCompareUrl(product.sourceUrl));
  for (const mp of ALL_MARKETPLACES) {
    const url = product.marketplaceUrls[mp];
    if (url) urls.add(normalizeCompareUrl(url));
  }
  return [...urls];
}

export function findDuplicateCompareProduct(
  products: CompareProduct[],
  incoming: CompareProduct,
): CompareProduct | null {
  const incomingUrls = new Set(collectProductUrls(incoming).map(normalizeCompareUrl));

  // Только точное совпадение URL или артикула на той же площадке.
  // Fuzzy по названию ломал добавление с WB: сливал с уже существующим Ozon/YM
  // и потом снова «искал» WB как чужую площадку → «похожие варианты» вместо своей карточки.
  for (const existing of products) {
    for (const url of collectProductUrls(existing)) {
      if (incomingUrls.has(normalizeCompareUrl(url))) {
        return existing;
      }
    }

    if (
      existing.article &&
      incoming.article &&
      existing.article === incoming.article &&
      existing.sourceMarketplace === incoming.sourceMarketplace
    ) {
      return existing;
    }

    const existingArticle = existing.articlesByMarketplace?.[incoming.sourceMarketplace];
    if (
      existingArticle &&
      incoming.article &&
      existingArticle === incoming.article
    ) {
      return existing;
    }
  }

  return null;
}

function pickBestTitle(existing: CompareProduct, incoming: CompareProduct): string {
  const candidates = [
    getBestTitle(existing),
    getBestTitle(incoming),
    existing.title,
    incoming.title,
  ].filter((t) => t && t !== 'Товар');

  if (!candidates.length) return incoming.title || existing.title;

  return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best));
}

export function mergeCompareProducts(
  existing: CompareProduct,
  incoming: CompareProduct,
): CompareProduct {
  const mergedOffers = {
    ...existing.marketplaceOffers,
    ...incoming.marketplaceOffers,
  };

  if (incoming.sourceOffer?.found) {
    mergedOffers[incoming.sourceMarketplace] = incoming.sourceOffer;
  }

  const mergedArticles: Partial<Record<ComparisonMarketplace, string>> = {
    ...existing.articlesByMarketplace,
    ...incoming.articlesByMarketplace,
  };

  if (incoming.article) {
    mergedArticles[incoming.sourceMarketplace] = incoming.article;
  }

  return {
    ...existing,
    title: pickBestTitle(existing, incoming),
    article: existing.article || incoming.article,
    productModel: existing.productModel || incoming.productModel,
    manualMarketplaces: {
      ...existing.manualMarketplaces,
      ...incoming.manualMarketplaces,
    },
    marketplaceUrls: {
      ...existing.marketplaceUrls,
      ...incoming.marketplaceUrls,
      [incoming.sourceMarketplace]: incoming.sourceUrl,
    },
    marketplaceOffers: mergedOffers,
    articlesByMarketplace: mergedArticles,
    sourceOffer:
      isOfferWithPrice(existing.sourceOffer) &&
      existing.sourceMarketplace === incoming.sourceMarketplace
        ? existing.sourceOffer
        : isOfferWithPrice(incoming.sourceOffer)
          ? incoming.sourceOffer
          : existing.sourceOffer ?? incoming.sourceOffer,
    sourceMarketplace: incoming.sourceOffer?.found
      ? incoming.sourceMarketplace
      : existing.sourceMarketplace,
    sourceUrl: incoming.sourceOffer?.found ? incoming.sourceUrl : existing.sourceUrl,
  };
}