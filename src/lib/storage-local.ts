/**
 * chrome.storage.local helpers safe for content scripts.
 * Must NOT import Supabase / Edge — keeps edge-* out of content WAR graph.
 */

import {
  assertScrapedPriceIdentity,
  logPriceIdentityReject,
  productsIdentityMatch,
  stableProductStorageId,
} from '@/lib/price-identity';
import type { PriceChange, PricePoint, Product, StorageSchema, TrackedProduct } from '@/types/product';
import { toCanonicalProductUrl } from '@/utils/product-url';

const STORAGE_KEY = 'priceguard_storage';
const MAX_HISTORY_POINTS = 100;
const MIN_RECORD_INTERVAL_MS = 5 * 60 * 1000;

const defaultStorage: StorageSchema = {
  trackedProducts: [],
  lastScrapedProduct: null,
  priceHistory: {},
};

export async function getStorage(): Promise<StorageSchema> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as StorageSchema | undefined;
  return {
    ...defaultStorage,
    ...stored,
    priceHistory: stored?.priceHistory ?? {},
  };
}

export async function setStorage(data: StorageSchema): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export async function getPriceHistory(productId: string): Promise<PricePoint[]> {
  const storage = await getStorage();
  return storage.priceHistory[productId] ?? [];
}

export async function clearPriceHistory(productId: string): Promise<void> {
  const storage = await getStorage();
  if (!storage.priceHistory[productId]) return;
  const next = { ...storage.priceHistory };
  delete next[productId];
  await setStorage({
    ...storage,
    priceHistory: next,
  });
}

export async function recordPricePoint(
  productId: string,
  price: number,
  timestamp = Date.now(),
): Promise<PriceChange | null> {
  const storage = await getStorage();
  const history = storage.priceHistory[productId] ?? [];
  const lastPoint = history[history.length - 1];

  if (
    lastPoint &&
    lastPoint.price === price &&
    timestamp - lastPoint.timestamp < MIN_RECORD_INTERVAL_MS
  ) {
    return null;
  }

  const previousPrice = lastPoint?.price ?? price;
  const dropped = lastPoint ? price < lastPoint.price : false;

  const nextHistory = [...history, { price, timestamp }].slice(-MAX_HISTORY_POINTS);

  await setStorage({
    ...storage,
    priceHistory: {
      ...storage.priceHistory,
      [productId]: nextHistory,
    },
  });

  if (!lastPoint || lastPoint.price === price) {
    return null;
  }

  return {
    productId,
    previousPrice,
    newPrice: price,
    dropped,
  };
}

export async function saveLastScrapedProduct(product: Product): Promise<void> {
  const storage = await getStorage();
  await setStorage({ ...storage, lastScrapedProduct: product });
}

export async function getLastScrapedProduct(): Promise<Product | null> {
  const storage = await getStorage();
  return storage.lastScrapedProduct;
}

export async function getTrackedProducts(): Promise<TrackedProduct[]> {
  const storage = await getStorage();
  return storage.trackedProducts;
}

/** Записать цену в историю при каждом визите на карточку (как Palert) */
export async function recordVisitPrice(product: Product): Promise<PriceChange | null> {
  const key = stableProductStorageId(product);
  if (!key) {
    logPriceIdentityReject(null, product, 'unstable_visit_id');
    return null;
  }
  return recordPricePoint(key, product.price, product.scrapedAt);
}

export async function isProductTracked(productId: string): Promise<boolean> {
  const tracked = await getTrackedProducts();
  return tracked.some((item) => item.id === productId);
}

export async function getTrackedProduct(productId: string): Promise<TrackedProduct | null> {
  const storage = await getStorage();
  return storage.trackedProducts.find((p) => p.id === productId) ?? null;
}

/**
 * Update local tracked price from scraped product (no cloud sync).
 * Content scripts must use this module — not `@/lib/storage`.
 */
export async function updateTrackedProductPrice(product: Product): Promise<PriceChange | null> {
  const scrapedKey = stableProductStorageId(product);
  if (!scrapedKey) {
    logPriceIdentityReject(null, product, 'unstable_scraped_id');
    return null;
  }

  const storage = await getStorage();
  const tracked = storage.trackedProducts.find(
    (item) => productsIdentityMatch(item, product).ok,
  );

  if (!tracked) {
    return null;
  }

  const identity = assertScrapedPriceIdentity(tracked, product);
  if (!identity.ok) {
    return null;
  }

  const historyId = stableProductStorageId(tracked) ?? tracked.id;
  const priceChange = await recordPricePoint(historyId, product.price, product.scrapedAt);

  const trackedProducts = storage.trackedProducts.map((item) => {
    if (!productsIdentityMatch(item, product).ok) return item;
    const stableId = stableProductStorageId(item) ?? item.id;
    return {
      ...item,
      ...product,
      id: item.id.startsWith('yandex_market-')
        ? item.id.replace(/^yandex_market-/, 'yandex-')
        :             item.id.startsWith('yandex-') ||
            item.id.startsWith('ozon-') ||
            item.id.startsWith('wb-') ||
            item.id.startsWith('mm-') ||
            item.id.startsWith('ae-') ||
            item.id.startsWith('mv-')
          ? item.id
          : stableId,
      article: identity.article || product.article || item.article,
      url: toCanonicalProductUrl(product.url || item.url, item.marketplace),
      imageUrl: product.imageUrl || item.imageUrl,
      imageUrlAlternatives: product.imageUrlAlternatives?.length
        ? product.imageUrlAlternatives
        : item.imageUrlAlternatives,
      lowestPrice: Math.min(
        item.lowestPrice > 0 ? item.lowestPrice : product.price,
        product.price > 0 ? product.price : item.lowestPrice,
      ),
    };
  });

  const latestStorage = await getStorage();
  await setStorage({ ...latestStorage, trackedProducts });

  return priceChange;
}

/** After local update — find the updated tracked row (for cloud push from storage.ts). */
export async function findTrackedMatchingProduct(
  product: Product,
): Promise<TrackedProduct | null> {
  const storage = await getStorage();
  return storage.trackedProducts.find((item) => productsIdentityMatch(item, product).ok) ?? null;
}
