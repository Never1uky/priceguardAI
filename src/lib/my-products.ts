/**
 * Thin adapter: tracked ∪ compare → «Мои товары».
 * Does not rewrite CompareProduct / TrackedProduct storage schemas.
 */
import type { CompareProduct, ComparisonMarketplace } from '@/types/comparison';
import type { Marketplace, TrackedProduct } from '@/types/product';
import { getCompareProducts, removeCompareProduct, saveCompareProducts } from '@/lib/comparison-storage';
import {
  collectProductUrls,
  findDuplicateCompareProduct,
  getBestTitle,
  mergeDuplicateCompareList,
} from '@/lib/compare-merge';
import { getCompareProductImageSources } from '@/lib/product-image';
import { getTrackedProducts, removeTrackedProduct } from '@/lib/storage';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/types/subscription';
import { normalizeCompareUrl } from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { isProductNotificationsEnabled } from '@/lib/notification-settings';
import { preferRealTitle } from '@/utils/wb-image';
import {
  clearCompareRunningForProducts,
  getRunningCompareProductId,
} from '@/lib/compare-jobs';
const MIGRATION_FLAG = 'priceguard_my_products_migrated_v1';
const SORT_KEY = 'priceguard_my_products_sort';

export type MyProductsSortMode = 'addedAt' | 'title' | 'price';

export async function getMyProductsSortMode(): Promise<MyProductsSortMode> {
  const stored = await chrome.storage.local.get(SORT_KEY);
  const mode = stored[SORT_KEY] as MyProductsSortMode | undefined;
  if (mode === 'title' || mode === 'price' || mode === 'addedAt') return mode;
  return 'addedAt';
}

export async function setMyProductsSortMode(mode: MyProductsSortMode): Promise<void> {
  await chrome.storage.local.set({ [SORT_KEY]: mode });
}

function itemAddedAt(item: MyProductItem): number {
  return (
    item.compareProduct?.addedAt ??
    item.trackedProduct?.trackedAt ??
    0
  );
}

function itemMinPrice(item: MyProductItem): number {
  const offers = item.compareProduct?.marketplaceOffers
    ? Object.values(item.compareProduct.marketplaceOffers)
    : [];
  let min = Infinity;
  for (const o of offers) {
    if (o && typeof o.price === 'number' && o.price > 0) min = Math.min(min, o.price);
  }
  if (
    item.compareProduct?.sourceOffer &&
    typeof item.compareProduct.sourceOffer.price === 'number' &&
    item.compareProduct.sourceOffer.price > 0
  ) {
    min = Math.min(min, item.compareProduct.sourceOffer.price);
  }
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

export function sortMyProductItems(
  items: MyProductItem[],
  mode: MyProductsSortMode = 'addedAt',
): MyProductItem[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (mode === 'title') {
      const cmp = a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    }
    if (mode === 'price') {
      const pa = itemMinPrice(a);
      const pb = itemMinPrice(b);
      if (pa !== pb) return pa - pb;
      return a.id.localeCompare(b.id);
    }
    // addedAt desc — never comparedAt (prevents jump on expand/research)
    const at = itemAddedAt(a);
    const bt = itemAddedAt(b);
    if (bt !== at) return bt - at;
    return a.id.localeCompare(b.id);
  });
  return copy;
}
export interface MyProductItem {
  /** Stable list key */
  id: string;
  compareId: string | null;
  trackedId: string | null;
  title: string;
  article?: string;
  sourceMarketplace: ComparisonMarketplace;
  sourceUrl: string;
  imageUrl?: string;
  imageUrlAlternatives?: string[];
  linkedMarketplaces: ComparisonMarketplace[];
  /** Price alerts / track enabled */
  alertsEnabled: boolean;
  compareProduct: CompareProduct | null;
  trackedProduct: TrackedProduct | null;
}

import { COMPARISON_MARKETPLACE_IDS } from '@/lib/marketplaces/registry';

const ALL_MP: ComparisonMarketplace[] = [...COMPARISON_MARKETPLACE_IDS];

function asComparisonMarketplace(mp: Marketplace | ComparisonMarketplace): ComparisonMarketplace {
  return mp as ComparisonMarketplace;
}

function normalizeUrlKey(url: string, marketplace?: ComparisonMarketplace): string {
  try {
    if (marketplace) return normalizeCompareUrl(toCanonicalProductUrl(url, marketplace));
    return normalizeCompareUrl(url);
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function articleKey(marketplace: string, article?: string | null): string | null {
  const a = article?.trim();
  if (!a) return null;
  return `${marketplace}:${a}`;
}

/** Match keys for a compare product */
export function compareMatchKeys(product: CompareProduct): string[] {
  const keys = new Set<string>();
  for (const url of collectProductUrls(product)) {
    keys.add(`url:${normalizeUrlKey(url)}`);
  }
  const art = articleKey(product.sourceMarketplace, product.article);
  if (art) keys.add(`art:${art}`);
  for (const [mp, a] of Object.entries(product.articlesByMarketplace ?? {})) {
    const k = articleKey(mp, a);
    if (k) keys.add(`art:${k}`);
  }
  return [...keys];
}

export function trackedMatchKeys(product: TrackedProduct): string[] {
  const keys = new Set<string>();
  const mp = asComparisonMarketplace(product.marketplace);
  if (product.url) keys.add(`url:${normalizeUrlKey(product.url, mp)}`);
  const art = articleKey(mp, product.article);
  if (art) keys.add(`art:${art}`);
  return [...keys];
}

export function keysOverlap(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((k) => set.has(k));
}

function linkedFromCompare(product: CompareProduct): ComparisonMarketplace[] {
  return ALL_MP.filter(
    (mp) =>
      Boolean(product.marketplaceUrls[mp]) ||
      product.sourceMarketplace === mp ||
      Boolean(product.marketplaceOffers?.[mp]?.url),
  );
}

function compareShellFromTracked(tracked: TrackedProduct): CompareProduct {
  const marketplace = asComparisonMarketplace(tracked.marketplace);
  const url = normalizeUrlKey(tracked.url, marketplace);
  const price = tracked.price > 0 ? tracked.price : null;
  const sourceOffer = {
    marketplace,
    title: tracked.title,
    price,
    oldPrice: tracked.oldPrice,
    delivery: null as string | null,
    rating: null as number | null,
    url,
    imageUrl: tracked.imageUrl,
    found: Boolean(price),
    matchStatus: 'verified' as const,
  };

  return {
    id: `cmp_from_tracked_${tracked.id}`,
    title: tracked.title,
    article: tracked.article || undefined,
    sourceUrl: url,
    sourceMarketplace: marketplace,
    marketplaceUrls: { [marketplace]: url },
    marketplaceOffers: { [marketplace]: sourceOffer },
    articlesByMarketplace: tracked.article
      ? { [marketplace]: tracked.article }
      : undefined,
    sourceOffer,
    addedAt: tracked.trackedAt || Date.now(),
    // Fresh comparedAt + priced source offer → shouldRunCompare false (no auto SERP)
    comparedAt: Date.now(),
    authenticity: tracked.authenticity,
  };
}

/**
 * Build unified list from tracked + compare (deduped).
 * Prefer compare row when both match; attach tracked for alerts.
 */
export function buildMyProductItems(
  tracked: TrackedProduct[],
  compare: CompareProduct[],
  alertsByTrackedId?: Record<string, boolean>,
): MyProductItem[] {
  const usedTracked = new Set<string>();
  const items: MyProductItem[] = [];

  for (const cmp of compare) {
    const cmpKeys = compareMatchKeys(cmp);
    const matchedTracked =
      tracked.find((t) => !usedTracked.has(t.id) && keysOverlap(cmpKeys, trackedMatchKeys(t))) ??
      null;
    if (matchedTracked) usedTracked.add(matchedTracked.id);

    const images = getCompareProductImageSources(cmp);
    const trackedId = matchedTracked?.id ?? null;
    const alertsEnabled = trackedId
      ? (alertsByTrackedId?.[trackedId] ?? matchedTracked?.notificationsEnabled !== false)
      : false;

    items.push({
      id: cmp.id,
      compareId: cmp.id,
      trackedId,
      title: preferRealTitle(getBestTitle(cmp), matchedTracked?.title),
      article: cmp.article || matchedTracked?.article,
      sourceMarketplace: cmp.sourceMarketplace,
      sourceUrl: cmp.sourceUrl,
      imageUrl: images.imageUrl || matchedTracked?.imageUrl,
      imageUrlAlternatives:
        images.imageUrlAlternatives?.length
          ? images.imageUrlAlternatives
          : matchedTracked?.imageUrlAlternatives,
      linkedMarketplaces: linkedFromCompare(cmp),
      alertsEnabled,
      compareProduct: cmp,
      trackedProduct: matchedTracked,
    });
  }

  for (const t of tracked) {
    if (usedTracked.has(t.id)) continue;
    const mp = asComparisonMarketplace(t.marketplace);
    items.push({
      id: `tracked:${t.id}`,
      compareId: null,
      trackedId: t.id,
      title: t.title,
      article: t.article || undefined,
      sourceMarketplace: mp,
      sourceUrl: t.url,
      imageUrl: t.imageUrl,
      imageUrlAlternatives: t.imageUrlAlternatives,
      linkedMarketplaces: [mp],
      alertsEnabled: alertsByTrackedId?.[t.id] ?? t.notificationsEnabled !== false,
      compareProduct: null,
      trackedProduct: t,
    });
  }

  return sortMyProductItems(items, 'addedAt');
}

/** Unique slots for Free limit (grandfather: existing may exceed). */
export async function getMyProductSlotCount(): Promise<number> {
  const [tracked, compare] = await Promise.all([getTrackedProducts(), getCompareProducts()]);
  return buildMyProductItems(tracked, compare).length;
}

export async function loadMyProductItems(
  sortMode?: MyProductsSortMode,
): Promise<MyProductItem[]> {
  const [tracked, compare, mode, running] = await Promise.all([
    getTrackedProducts(),
    getCompareProducts(),
    sortMode ? Promise.resolve(sortMode) : getMyProductsSortMode(),
    getRunningCompareProductId(),
  ]);
  // While research runs — do not collapse the active row into another product
  let merged = compare;
  if (!running) {
    merged = mergeDuplicateCompareList(compare);
    if (merged.length < compare.length) {
      await saveCompareProducts(merged);
    }
  }
  const alerts: Record<string, boolean> = {};
  for (const t of tracked) {
    alerts[t.id] = isProductNotificationsEnabled(t);
  }
  return sortMyProductItems(buildMyProductItems(tracked, merged, alerts), mode);
}

export function getMyProductsLimit(premium = false): number {
  return premium ? PREMIUM_LIMITS.maxMyProducts : FREE_LIMITS.maxMyProducts;
}

/**
 * One-time migration: create compare shells for tracked-only items (no auto SERP).
 * Idempotent via storage flag.
 */
export async function migrateMyProductsOnce(): Promise<{ migrated: boolean; created: number }> {
  const stored = await chrome.storage.local.get(MIGRATION_FLAG);
  if (stored[MIGRATION_FLAG]) {
    return { migrated: false, created: 0 };
  }

  const [tracked, compare] = await Promise.all([getTrackedProducts(), getCompareProducts()]);
  const nextCompare = [...compare];
  let created = 0;

  for (const t of tracked) {
    const shell = compareShellFromTracked(t);
    const dup = findDuplicateCompareProduct(nextCompare, shell);
    if (dup) continue;
    nextCompare.unshift(shell);
    created += 1;
  }

  if (created > 0) {
    await saveCompareProducts(nextCompare);
  }

  await chrome.storage.local.set({ [MIGRATION_FLAG]: true });
  return { migrated: true, created };
}

/**
 * Ensure a compare product exists for a my-product row (lazy, no research).
 * Returns compare id.
 */
export async function ensureCompareShellForTracked(
  tracked: TrackedProduct,
): Promise<CompareProduct> {
  const compare = await getCompareProducts();
  const shell = compareShellFromTracked(tracked);
  const dup = findDuplicateCompareProduct(compare, shell);
  if (dup) return dup;
  await saveCompareProducts([shell, ...compare]);
  return shell;
}

export function findMyProductByUrl(
  items: MyProductItem[],
  url: string,
  marketplace?: ComparisonMarketplace,
): MyProductItem | null {
  const key = `url:${normalizeUrlKey(url, marketplace)}`;
  for (const item of items) {
    const keys = item.compareProduct
      ? compareMatchKeys(item.compareProduct)
      : item.trackedProduct
        ? trackedMatchKeys(item.trackedProduct)
        : [`url:${normalizeUrlKey(item.sourceUrl, item.sourceMarketplace)}`];
    if (keys.includes(key)) return item;
  }
  return null;
}

/**
 * Remove compare + tracked for a My Products row (including URL/article overlaps).
 * Stops in-flight compare research for removed compare ids so progress cannot resurrect.
 */
export async function removeMyProductEntities(item: MyProductItem): Promise<void> {
  const [tracked, compare] = await Promise.all([getTrackedProducts(), getCompareProducts()]);
  const trackedToRemove = new Set<string>();
  const compareToRemove = new Set<string>();

  if (item.trackedId) trackedToRemove.add(item.trackedId);
  if (item.compareId) compareToRemove.add(item.compareId);

  if (item.compareProduct) {
    const keys = compareMatchKeys(item.compareProduct);
    for (const t of tracked) {
      if (keysOverlap(keys, trackedMatchKeys(t))) trackedToRemove.add(t.id);
    }
  }
  if (item.trackedProduct) {
    const keys = trackedMatchKeys(item.trackedProduct);
    for (const c of compare) {
      if (keysOverlap(keys, compareMatchKeys(c))) compareToRemove.add(c.id);
    }
  }

  await clearCompareRunningForProducts(compareToRemove);

  await Promise.all([
    ...[...trackedToRemove].map((id) => removeTrackedProduct(id)),
    ...[...compareToRemove].map((id) => removeCompareProduct(id)),
  ]);
}
