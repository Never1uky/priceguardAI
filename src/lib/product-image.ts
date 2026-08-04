/**
 * Resolve / hydrate product images for tracked + compare after sync / open / add.
 * Soft-fail: never throw to callers; returns empty if network/API unavailable.
 */
import type { ComparisonMarketplace, CompareProduct, MarketplaceOffer } from '@/types/comparison';
import type { Marketplace, Product, TrackedProduct } from '@/types/product';
import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';
import {
  buildWbImageUrl,
  buildWbImageUrlAlternatives,
} from '@/utils/wb-image';
import { extractArticle } from '@/utils/marketplace';
import { extractComparisonArticle } from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';

export type ImageMarketplace = Marketplace | ComparisonMarketplace;

export interface ProductImageFields {
  imageUrl?: string;
  imageUrlAlternatives?: string[];
}

export interface ResolveProductImageInput {
  marketplace: ImageMarketplace;
  url?: string;
  article?: string;
  imageUrl?: string;
  imageUrlAlternatives?: string[];
  /** Prefer network refetch even if a stale URL exists */
  force?: boolean;
}

function uniqUrls(urls: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const t = u?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function wbNmId(input: ResolveProductImageInput): string | null {
  if (input.article && /^\d+$/.test(input.article.trim())) return input.article.trim();
  if (input.url) {
    return (
      extractArticle(input.url, 'wildberries') ||
      extractComparisonArticle(input.url, 'wildberries') ||
      null
    );
  }
  return null;
}

function wbSeedImage(nmId: string, stale?: ProductImageFields): ProductImageFields {
  const primary = buildWbImageUrl(nmId);
  const alternatives = uniqUrls([
    stale?.imageUrl,
    primary,
    ...buildWbImageUrlAlternatives(nmId),
    ...(stale?.imageUrlAlternatives ?? []),
  ]).filter((u) => u !== primary);
  return {
    imageUrl: stale?.imageUrl?.includes('/images/') ? stale.imageUrl : primary,
    imageUrlAlternatives: alternatives,
  };
}

async function resolveWildberriesImage(
  input: ResolveProductImageInput,
): Promise<ProductImageFields> {
  const nmId = wbNmId(input);
  if (!nmId) {
    return {
      imageUrl: input.imageUrl,
      imageUrlAlternatives: input.imageUrlAlternatives,
    };
  }

  const seeded = wbSeedImage(nmId, input);
  if (!input.force && input.imageUrl && (input.imageUrlAlternatives?.length ?? 0) > 2) {
    return {
      imageUrl: input.imageUrl,
      imageUrlAlternatives: uniqUrls([
        ...(input.imageUrlAlternatives ?? []),
        ...buildWbImageUrlAlternatives(nmId),
      ]),
    };
  }

  try {
    const api = await fetchWildberriesProduct(nmId);
    if (api?.imageUrl) {
      return {
        imageUrl: api.imageUrl,
        imageUrlAlternatives: uniqUrls([
          api.imageUrl,
          ...(api.imageUrlAlternatives ?? []),
          ...buildWbImageUrlAlternatives(nmId),
          input.imageUrl,
        ]).filter((u) => u !== api.imageUrl),
      };
    }
  } catch {
    // soft
  }

  return seeded;
}

async function resolveViaOfferFetch(
  marketplace: ComparisonMarketplace,
  url: string,
  stale?: ProductImageFields,
): Promise<ProductImageFields> {
  try {
    const pageUrl = toCanonicalProductUrl(url, marketplace);
    const offer = await fetchOfferFromUrl(pageUrl, marketplace, {
      skipUnlocker: true,
    });
    if (offer?.imageUrl) {
      return {
        imageUrl: offer.imageUrl,
        imageUrlAlternatives: uniqUrls([
          offer.imageUrl,
          stale?.imageUrl,
          ...(stale?.imageUrlAlternatives ?? []),
        ]).filter((u) => u !== offer.imageUrl),
      };
    }
  } catch {
    // soft
  }
  return {
    imageUrl: stale?.imageUrl,
    imageUrlAlternatives: stale?.imageUrlAlternatives,
  };
}

/** Resolve best-effort image URLs for a marketplace product. */
export async function resolveMarketplaceImage(
  input: ResolveProductImageInput,
): Promise<ProductImageFields> {
  const marketplace = input.marketplace;
  if (marketplace === 'wildberries') {
    return resolveWildberriesImage(input);
  }

  if (!input.force && input.imageUrl) {
    return {
      imageUrl: input.imageUrl,
      imageUrlAlternatives: input.imageUrlAlternatives,
    };
  }

  if (!input.url) {
    return {
      imageUrl: input.imageUrl,
      imageUrlAlternatives: input.imageUrlAlternatives,
    };
  }

  return resolveViaOfferFetch(marketplace, input.url, input);
}

/** Sync seed (no network) — WB basket CDN URLs for immediate paint. */
export function seedProductImageSync<T extends ProductImageFields & {
  marketplace: ImageMarketplace;
  url?: string;
  article?: string;
}>(product: T): T {
  if (product.marketplace !== 'wildberries') return product;
  const nmId = wbNmId({
    marketplace: 'wildberries',
    article: product.article,
    url: product.url,
  });
  if (!nmId) return product;
  const seeded = wbSeedImage(nmId, product);
  return {
    ...product,
    imageUrl: seeded.imageUrl || product.imageUrl,
    imageUrlAlternatives: seeded.imageUrlAlternatives?.length
      ? seeded.imageUrlAlternatives
      : product.imageUrlAlternatives,
  };
}

/** Apply resolved image onto a Product / TrackedProduct. */
export async function ensureProductImage<T extends Product>(
  product: T,
  options?: { force?: boolean },
): Promise<T> {
  const seeded = seedProductImageSync(product);

  if (!options?.force && seeded.imageUrl && (seeded.imageUrlAlternatives?.length ?? 0) > 0) {
    // Still refresh WB alternatives (cheap) without network when possible
    if (seeded.marketplace === 'wildberries') {
      const nmId = wbNmId({
        marketplace: 'wildberries',
        article: seeded.article,
        url: seeded.url,
      });
      if (nmId) {
        return {
          ...seeded,
          imageUrlAlternatives: uniqUrls([
            ...(seeded.imageUrlAlternatives ?? []),
            ...buildWbImageUrlAlternatives(nmId),
          ]),
        };
      }
    }
    return seeded;
  }

  const resolved = await resolveMarketplaceImage({
    marketplace: seeded.marketplace,
    url: seeded.url,
    article: seeded.article,
    imageUrl: seeded.imageUrl,
    imageUrlAlternatives: seeded.imageUrlAlternatives,
    force: options?.force,
  });

  if (!resolved.imageUrl && !resolved.imageUrlAlternatives?.length) return seeded;

  return {
    ...seeded,
    imageUrl: resolved.imageUrl || seeded.imageUrl,
    imageUrlAlternatives: resolved.imageUrlAlternatives?.length
      ? resolved.imageUrlAlternatives
      : seeded.imageUrlAlternatives,
  };
}

export function getCompareProductImageSources(product: CompareProduct): ProductImageFields {
  const sourceMp = product.sourceMarketplace;
  const fromSource = product.sourceOffer;
  const fromOffer = product.marketplaceOffers?.[sourceMp];
  const imageUrl = fromSource?.imageUrl || fromOffer?.imageUrl;
  const article =
    product.article ||
    product.articlesByMarketplace?.[sourceMp] ||
    (product.sourceUrl
      ? extractComparisonArticle(product.sourceUrl, sourceMp) ?? undefined
      : undefined);

  let alternatives = uniqUrls([
    fromSource?.imageUrl,
    fromOffer?.imageUrl,
  ]);

  if (sourceMp === 'wildberries' && article) {
    alternatives = uniqUrls([
      ...alternatives,
      buildWbImageUrl(article),
      ...buildWbImageUrlAlternatives(article),
    ]);
  }

  const primary = imageUrl || alternatives[0];
  return {
    imageUrl: primary,
    imageUrlAlternatives: alternatives.filter((u) => u !== primary),
  };
}

function withImageOnCompare(
  product: CompareProduct,
  image: ProductImageFields,
): CompareProduct {
  if (!image.imageUrl) return product;

  const patchOffer = (offer: MarketplaceOffer | undefined): MarketplaceOffer | undefined => {
    if (!offer) {
      return {
        marketplace: product.sourceMarketplace,
        title: product.title,
        price: null,
        delivery: null,
        rating: null,
        url: product.sourceUrl,
        found: false,
        imageUrl: image.imageUrl,
      };
    }
    if (offer.imageUrl && !image.imageUrl) return offer;
    return {
      ...offer,
      imageUrl: image.imageUrl || offer.imageUrl,
    };
  };

  const sourceOffer = patchOffer(product.sourceOffer);
  const marketplaceOffers = {
    ...product.marketplaceOffers,
    [product.sourceMarketplace]: patchOffer(
      product.marketplaceOffers?.[product.sourceMarketplace] ?? sourceOffer,
    ),
  };

  return {
    ...product,
    sourceOffer,
    marketplaceOffers,
  };
}

/** Ensure compare product has an image on sourceOffer (persisted by caller). */
export async function ensureCompareProductImage(
  product: CompareProduct,
  options?: { force?: boolean },
): Promise<CompareProduct> {
  const existing = getCompareProductImageSources(product);
  if (!options?.force && existing.imageUrl) {
    // Enrich WB alternatives without network
    if (product.sourceMarketplace === 'wildberries') {
      return withImageOnCompare(product, existing);
    }
    return product;
  }

  const article =
    product.article ||
    product.articlesByMarketplace?.[product.sourceMarketplace] ||
    undefined;

  const resolved = await resolveMarketplaceImage({
    marketplace: product.sourceMarketplace,
    url: product.sourceUrl,
    article,
    imageUrl: existing.imageUrl,
    imageUrlAlternatives: existing.imageUrlAlternatives,
    force: options?.force || !existing.imageUrl,
  });

  if (!resolved.imageUrl) return withImageOnCompare(product, existing);
  return withImageOnCompare(product, resolved);
}

const hydrateInFlight = new Set<string>();

/** Background hydrate for tracked list after sync (concurrency-limited). */
export async function hydrateTrackedImages(
  products: TrackedProduct[],
  persist: (updated: TrackedProduct[]) => Promise<void>,
): Promise<void> {
  const need = products.filter(
    (p) =>
      !p.imageUrl ||
      (p.marketplace === 'wildberries' && (p.imageUrlAlternatives?.length ?? 0) < 3),
  );
  if (!need.length) return;

  const updatedMap = new Map<string, TrackedProduct>();
  const queue = need.slice(0, 12);
  const workers = 2;

  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const product = queue[i]!;
      const key = `tracked:${product.id}`;
      if (hydrateInFlight.has(key)) continue;
      hydrateInFlight.add(key);
      try {
        const next = await ensureProductImage(product, {
          force: !product.imageUrl,
        });
        if (
          next.imageUrl !== product.imageUrl ||
          (next.imageUrlAlternatives?.length ?? 0) !== (product.imageUrlAlternatives?.length ?? 0)
        ) {
          updatedMap.set(product.id, next);
        }
      } catch {
        // soft
      } finally {
        hydrateInFlight.delete(key);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (!updatedMap.size) return;

  const merged = products.map((p) => updatedMap.get(p.id) ?? p);
  await persist(merged);
}

/** Background hydrate for compare list after sync. */
export async function hydrateCompareImages(
  products: CompareProduct[],
  persist: (updated: CompareProduct[]) => Promise<void>,
): Promise<void> {
  const need = products.filter((p) => !getCompareProductImageSources(p).imageUrl);
  // Also refresh WB sources that only have a guessed CDN URL
  const wbMaybeStale = products.filter(
    (p) =>
      p.sourceMarketplace === 'wildberries' &&
      Boolean(getCompareProductImageSources(p).imageUrl),
  );
  const queue = uniqById([...need, ...wbMaybeStale.slice(0, 8)]).slice(0, 12);
  if (!queue.length) return;

  const updatedMap = new Map<string, CompareProduct>();
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const product = queue[i]!;
      const key = `cmp:${product.id}`;
      if (hydrateInFlight.has(key)) continue;
      hydrateInFlight.add(key);
      try {
        const before = getCompareProductImageSources(product).imageUrl;
        const next = await ensureCompareProductImage(product, {
          force: !before,
        });
        const after = getCompareProductImageSources(next).imageUrl;
        if (after && after !== before) {
          updatedMap.set(product.id, next);
        } else if (!before && after) {
          updatedMap.set(product.id, next);
        } else if (next !== product && after) {
          updatedMap.set(product.id, next);
        }
      } catch {
        // soft
      } finally {
        hydrateInFlight.delete(key);
      }
    }
  }

  await Promise.all([worker(), worker()]);
  if (!updatedMap.size) return;
  await persist(products.map((p) => updatedMap.get(p.id) ?? p));
}

function uniqById(products: CompareProduct[]): CompareProduct[] {
  const seen = new Set<string>();
  const out: CompareProduct[] = [];
  for (const p of products) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
