import {
  isOfferWithPrice,
  isPendingManualChoice,
  preferRicherMarketplaceOffer,
} from '@/lib/compare-offers';
import { areCategoriesIncompatible } from '@/lib/category-plugins';
import { inferProductCategory } from '@/lib/match-category';
import { areBrandsCompatible } from '@/lib/model-extract';
import { COMPARISON_MARKETPLACE_IDS } from '@/lib/marketplaces/registry';
import type {
  CompareProduct,
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { normalizeCompareUrl } from '@/utils/comparison-url';
import { isGenericProductTitle } from '@/utils/wb-image';

const ALL_MARKETPLACES: ComparisonMarketplace[] = [...COMPARISON_MARKETPLACE_IDS];

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
  if (product.title && !isGenericProductTitle(product.title)) {
    return product.title;
  }

  for (const offer of Object.values(product.marketplaceOffers ?? {})) {
    if (offer?.title && !isGenericProductTitle(offer.title)) {
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
  const add = (raw?: string | null) => {
    if (!raw?.trim()) return;
    try {
      urls.add(normalizeCompareUrl(raw));
    } catch {
      urls.add(raw.split('?')[0].split('#')[0]);
    }
  };

  add(product.sourceUrl);
  for (const mp of ALL_MARKETPLACES) {
    add(product.marketplaceUrls[mp]);
    add(product.marketplaceOffers?.[mp]?.url);
  }
  if (product.sourceOffer?.url) add(product.sourceOffer.url);
  return [...urls];
}

/** Article keys scoped by marketplace — never merge WB↔Ozon by bare numeric id. */
export function collectScopedArticles(product: CompareProduct): Set<string> {
  const out = new Set<string>();
  const add = (mp: ComparisonMarketplace | string, raw?: string | null) => {
    const a = raw?.trim();
    if (!a || !mp) return;
    out.add(`${mp}:${a}`);
  };
  add(product.sourceMarketplace, product.article);
  for (const [mp, a] of Object.entries(product.articlesByMarketplace ?? {})) {
    add(mp, a);
  }
  return out;
}

/** @deprecated Prefer collectScopedArticles — raw ids collide across marketplaces. */
export function collectRawArticles(product: CompareProduct): Set<string> {
  const out = new Set<string>();
  const add = (raw?: string | null) => {
    const a = raw?.trim();
    if (a) out.add(a);
  };
  add(product.article);
  for (const a of Object.values(product.articlesByMarketplace ?? {})) {
    add(a);
  }
  return out;
}

function articlesIntersect(a: CompareProduct, b: CompareProduct): boolean {
  const left = collectScopedArticles(a);
  if (!left.size) return false;
  for (const key of collectScopedArticles(b)) {
    if (left.has(key)) return true;
  }
  return false;
}

/** Brand / category guard before collapsing compare rows. */
export function areCompareProductsCompatibleForMerge(
  a: CompareProduct,
  b: CompareProduct,
): boolean {
  const titleA = getBestTitle(a);
  const titleB = getBestTitle(b);

  if (!areBrandsCompatible(titleA, titleB)) return false;

  const catA = inferProductCategory(titleA);
  const catB = inferProductCategory(titleB);
  if (areCategoriesIncompatible(catA, catB)) return false;
  if (catA !== 'generic' && catB !== 'generic' && catA !== catB) return false;

  return true;
}

export function findDuplicateCompareProduct(
  products: CompareProduct[],
  incoming: CompareProduct,
): CompareProduct | null {
  const incomingUrls = new Set(collectProductUrls(incoming).map(normalizeCompareUrl));

  // URL overlap (any bound / offer URL) or same marketplace-scoped article.
  // Fuzzy title match intentionally omitted — it merged unrelated WB/Ozon rows.
  for (const existing of products) {
    let urlHit = false;
    for (const url of collectProductUrls(existing)) {
      if (incomingUrls.has(normalizeCompareUrl(url))) {
        urlHit = true;
        break;
      }
    }

    const articleHit = articlesIntersect(existing, incoming);
    if (!urlHit && !articleHit) continue;

    if (!areCompareProductsCompatibleForMerge(existing, incoming)) {
      continue;
    }

    return existing;
  }

  return null;
}

/** Collapse duplicate compare rows (same URL/article across MPs) into one. */
export function mergeDuplicateCompareList(products: CompareProduct[]): CompareProduct[] {
  const result: CompareProduct[] = [];
  for (const product of products) {
    const dup = findDuplicateCompareProduct(result, product);
    if (!dup) {
      result.push(product);
      continue;
    }
    const idx = result.findIndex((p) => p.id === dup.id);
    if (idx < 0) {
      result.push(product);
      continue;
    }
    result[idx] = mergeCompareProducts(dup, product);
  }
  return result;
}

function pickBestTitle(existing: CompareProduct, incoming: CompareProduct): string {
  const candidates = [
    getBestTitle(existing),
    getBestTitle(incoming),
    existing.title,
    incoming.title,
  ].filter((t) => t && !isGenericProductTitle(t));

  if (!candidates.length) return incoming.title || existing.title;

  return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best));
}

export function mergeCompareProducts(
  existing: CompareProduct,
  incoming: CompareProduct,
): CompareProduct {
  // Prefer newer comparedAt when both set (cloud vs local race).
  // Used below when two pending needs_choice offers tie on candidate count.
  const existingNewerOrEqual =
    (existing.comparedAt ?? 0) >= (incoming.comparedAt ?? 0);
  const comparedAt =
    existing.comparedAt != null && incoming.comparedAt != null
      ? Math.max(existing.comparedAt, incoming.comparedAt)
      : (incoming.comparedAt ?? existing.comparedAt);

  const offerKeys = new Set<ComparisonMarketplace>([
    ...ALL_MARKETPLACES.filter((mp) => existing.marketplaceOffers?.[mp] || incoming.marketplaceOffers?.[mp]),
  ]);

  const mergedOffers: Partial<Record<ComparisonMarketplace, MarketplaceOffer>> = {
    ...existing.marketplaceOffers,
  };
  for (const mp of offerKeys) {
    const prev = existing.marketplaceOffers?.[mp];
    const next = incoming.marketplaceOffers?.[mp];
    if (prev && next) {
      // Richer ambiguous / pending choice wins over empty not_found (see preferRicherMarketplaceOffer).
      mergedOffers[mp] = preferRicherMarketplaceOffer(prev, next, {
        preferAIfEqualAmbiguous: existingNewerOrEqual,
      });
    } else if (next) {
      mergedOffers[mp] = next;
    } else if (prev) {
      mergedOffers[mp] = prev;
    }
  }

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

  const mergedPools: Partial<Record<ComparisonMarketplace, SearchCandidateOffer[]>> = {
    ...existing.candidatePoolByMarketplace,
  };
  const poolKeys = new Set<ComparisonMarketplace>([
    ...ALL_MARKETPLACES.filter(
      (mp) => existing.candidatePoolByMarketplace?.[mp] || incoming.candidatePoolByMarketplace?.[mp],
    ),
  ]);
  for (const mp of poolKeys) {
    const prev = existing.candidatePoolByMarketplace?.[mp];
    const next = incoming.candidatePoolByMarketplace?.[mp];
    if (next?.length) mergedPools[mp] = next;
    else if (prev?.length) mergedPools[mp] = prev;
  }

  const mergedPoolFetchedAt: Partial<Record<ComparisonMarketplace, number>> = {
    ...existing.poolFetchedAt,
    ...incoming.poolFetchedAt,
  };
  for (const mp of poolKeys) {
    const prevAt = existing.poolFetchedAt?.[mp];
    const nextAt = incoming.poolFetchedAt?.[mp];
    if (prevAt != null && nextAt != null) {
      mergedPoolFetchedAt[mp] = Math.max(prevAt, nextAt);
    }
  }

  const mergedManual = {
    ...existing.manualMarketplaces,
    ...incoming.manualMarketplaces,
  };

  const mergedUrls: Partial<Record<ComparisonMarketplace, string>> = {
    ...existing.marketplaceUrls,
    ...incoming.marketplaceUrls,
    [incoming.sourceMarketplace]: incoming.sourceUrl,
  };
  // Pending picker must not keep a stale "bound" product URL (refresh would wipe candidates).
  for (const mp of ALL_MARKETPLACES) {
    if (mergedManual[mp]) continue;
    if (isPendingManualChoice(mergedOffers[mp])) {
      delete mergedUrls[mp];
    }
  }

  return {
    ...existing,
    title: pickBestTitle(existing, incoming),
    article: existing.article || incoming.article,
    productModel: existing.productModel || incoming.productModel,
    manualMarketplaces: mergedManual,
    marketplaceUrls: mergedUrls,
    marketplaceOffers: mergedOffers,
    articlesByMarketplace: mergedArticles,
    candidatePoolByMarketplace: Object.keys(mergedPools).length ? mergedPools : existing.candidatePoolByMarketplace,
    poolFetchedAt: Object.keys(mergedPoolFetchedAt).length
      ? mergedPoolFetchedAt
      : existing.poolFetchedAt,
    comparedAt,
    rejectedOfferUrls: {
      ...existing.rejectedOfferUrls,
      ...incoming.rejectedOfferUrls,
    },
    rejectedOfferFingerprints: {
      ...existing.rejectedOfferFingerprints,
      ...incoming.rejectedOfferFingerprints,
    },
    searchVariantByMarketplace: {
      ...existing.searchVariantByMarketplace,
      ...incoming.searchVariantByMarketplace,
    },
    sourceOffer: (() => {
      const picked =
        isOfferWithPrice(existing.sourceOffer) &&
        existing.sourceMarketplace === incoming.sourceMarketplace
          ? existing.sourceOffer
          : isOfferWithPrice(incoming.sourceOffer)
            ? incoming.sourceOffer
            : existing.sourceOffer ?? incoming.sourceOffer;
      if (!picked) return picked;
      const imageUrl =
        picked.imageUrl ||
        existing.sourceOffer?.imageUrl ||
        incoming.sourceOffer?.imageUrl ||
        existing.marketplaceOffers?.[existing.sourceMarketplace]?.imageUrl ||
        incoming.marketplaceOffers?.[incoming.sourceMarketplace]?.imageUrl;
      return imageUrl && !picked.imageUrl ? { ...picked, imageUrl } : picked;
    })(),
    sourceMarketplace: incoming.sourceOffer?.found
      ? incoming.sourceMarketplace
      : existing.sourceMarketplace,
    sourceUrl: incoming.sourceOffer?.found ? incoming.sourceUrl : existing.sourceUrl,
  };
}