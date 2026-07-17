import type { PriceChange, PricePoint, Product, StorageSchema, TrackedProduct } from '@/types/product';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import {
  pushTrackedProduct,
  pushTrackedTombstone,
  syncTrackedProducts as remoteSyncTracked,
} from '@/lib/supabase/tracked-sync';

/** Ключ товара для облачной синхронизации: article с фолбэком на id. */
function trackedKey(item: { article?: string; id: string }): string {
  return (item.article && item.article.trim()) || item.id;
}

const STORAGE_KEY = 'priceguard_storage';
const MAX_HISTORY_POINTS = 100;
const MIN_RECORD_INTERVAL_MS = 5 * 60 * 1000;

async function cloudPushTracked(tracked: TrackedProduct): Promise<void> {
  try {
    await pushTrackedProduct(tracked);
  } catch {
    // content script / invalidated context — не мешаем основному сценарию
  }
}

async function cloudPushTombstone(marketplace: TrackedProduct['marketplace'], key: string): Promise<void> {
  try {
    await pushTrackedTombstone(marketplace, key);
  } catch {
    // ignore
  }
}

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

async function setStorage(data: StorageSchema): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export async function getPriceHistory(productId: string): Promise<PricePoint[]> {
  const storage = await getStorage();
  return storage.priceHistory[productId] ?? [];
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
  return recordPricePoint(product.id, product.price, product.scrapedAt);
}

export async function isProductTracked(productId: string): Promise<boolean> {
  const tracked = await getTrackedProducts();
  return tracked.some((item) => item.id === productId);
}

export async function getTrackedProduct(productId: string): Promise<TrackedProduct | null> {
  const storage = await getStorage();
  return storage.trackedProducts.find((p) => p.id === productId) ?? null;
}

export async function setTargetPrice(
  productId: string,
  targetPrice: number | null,
): Promise<void> {
  const storage = await getStorage();
  const trackedProducts = storage.trackedProducts.map((item) =>
    item.id === productId ? { ...item, targetPrice: targetPrice ?? undefined } : item,
  );
  await setStorage({ ...storage, trackedProducts });

  const updated = trackedProducts.find((item) => item.id === productId);
  if (updated) void cloudPushTracked(updated);
}

export async function trackProduct(product: Product): Promise<TrackedProduct> {
  const storage = await getStorage();
  const normalized: Product = {
    ...product,
    url: toCanonicalProductUrl(product.url, product.marketplace),
  };
  const existing = storage.trackedProducts.find((item) => item.id === normalized.id);

  if (existing) {
    return existing;
  }

  const tracked: TrackedProduct = {
    ...normalized,
    trackedAt: Date.now(),
    initialPrice: normalized.price,
    lowestPrice: normalized.price,
    notificationsEnabled: true,
  };

  const history = storage.priceHistory[normalized.id] ?? [];
  const priceHistory = {
    ...storage.priceHistory,
    [normalized.id]: history.length
      ? history
      : [{ price: normalized.price, timestamp: Date.now() }],
  };

  await setStorage({
    ...storage,
    trackedProducts: [tracked, ...storage.trackedProducts],
    priceHistory,
  });

  // Отправляем в облако для синхронизации с другими устройствами (fire-and-forget).
  void cloudPushTracked(tracked);

  return tracked;
}

export async function untrackProduct(productId: string): Promise<void> {
  const storage = await getStorage();
  const { [productId]: _removed, ...priceHistory } = storage.priceHistory;
  const removed = storage.trackedProducts.find((item) => item.id === productId);

  await setStorage({
    ...storage,
    trackedProducts: storage.trackedProducts.filter((item) => item.id !== productId),
    priceHistory,
  });

  // Синхронизируем удаление между устройствами (tombstone).
  if (removed) {
    void cloudPushTombstone(removed.marketplace, trackedKey(removed));
  }
}

/** Удалить товар из отслеживаемых (алиас для UI и background) */
export const removeTrackedProduct = untrackProduct;

/** Включить/выключить уведомления для конкретного отслеживаемого товара */
export async function setTrackedNotificationsEnabled(
  productId: string,
  enabled: boolean,
): Promise<void> {
  const storage = await getStorage();
  const trackedProducts = storage.trackedProducts.map((item) =>
    item.id === productId ? { ...item, notificationsEnabled: enabled } : item,
  );
  await setStorage({ ...storage, trackedProducts });

  const updated = trackedProducts.find((item) => item.id === productId);
  if (updated) void cloudPushTracked(updated);
}

export async function updateTrackedProductPrice(product: Product): Promise<PriceChange | null> {
  const storage = await getStorage();
  const productArticle = (product.article && product.article.trim()) || '';
  const tracked = storage.trackedProducts.find(
    (item) =>
      item.id === product.id ||
      (item.marketplace === product.marketplace &&
        productArticle &&
        trackedKey(item) === productArticle),
  );
  const isTracked = Boolean(tracked);

  let priceChange: PriceChange | null = null;

  if (isTracked && tracked) {
    priceChange = await recordPricePoint(tracked.id, product.price, product.scrapedAt);
  }

  const trackedProducts = storage.trackedProducts.map((item) => {
    const same =
      item.id === product.id ||
      (item.marketplace === product.marketplace &&
        productArticle &&
        trackedKey(item) === productArticle);
    if (!same) return item;
    return {
      ...item,
      ...product,
      id: item.id.startsWith('yandex_market-')
        ? item.id.replace(/^yandex_market-/, 'yandex-')
        : item.id.startsWith('yandex-') || item.id.startsWith('ozon-') || item.id.startsWith('wb-')
          ? item.id
          : product.id,
      article: product.article || item.article,
      lowestPrice: Math.min(
        item.lowestPrice > 0 ? item.lowestPrice : product.price,
        product.price > 0 ? product.price : item.lowestPrice,
      ),
    };
  });

  const latestStorage = await getStorage();
  await setStorage({ ...latestStorage, trackedProducts });

  if (isTracked) {
    const updated = trackedProducts.find(
      (item) =>
        item.id === product.id ||
        (item.marketplace === product.marketplace &&
          productArticle &&
          trackedKey(item) === productArticle),
    );
    if (updated) void cloudPushTracked(updated);
  }

  return priceChange;
}

function isPlaceholderTitle(title: string | undefined): boolean {
  const t = (title ?? '').trim().toLowerCase();
  return !t || t === 'товар' || t === 'product';
}

function mergeTrackedFields(
  local: TrackedProduct,
  remote: TrackedProduct,
): TrackedProduct {
  const remotePrice = Number(remote.price) || 0;
  const localPrice = Number(local.price) || 0;
  const price = remotePrice > 0 ? remotePrice : localPrice;
  const title =
    !isPlaceholderTitle(remote.title) && remote.title
      ? remote.title
      : local.title;
  const imageUrl = remote.imageUrl || local.imageUrl;
  const imageUrlAlternatives =
    remote.imageUrlAlternatives?.length
      ? remote.imageUrlAlternatives
      : local.imageUrlAlternatives;

  return {
    ...local,
    ...remote,
    id: local.id.startsWith('yandex_market-')
      ? local.id.replace(/^yandex_market-/, 'yandex-')
      : local.id,
    title,
    price,
    imageUrl,
    imageUrlAlternatives,
    url: remote.url?.startsWith('http') ? remote.url : local.url,
    lowestPrice: Math.min(
      local.lowestPrice > 0 ? local.lowestPrice : price || Infinity,
      price > 0 ? price : Infinity,
    ) || price,
    targetPrice: remote.targetPrice ?? local.targetPrice,
    notes: remote.notes ?? local.notes,
  };
}

/**
 * Полная двусторонняя синхронизация с облаком (требует Supabase Auth).
 * - Добавляет товары с других устройств
 * - Удаляет локально tombstone с сервера
 * - Обновляет цены/target/notes с сервера (не затирает хорошие локальные данные нулями)
 */
export async function syncTrackedProductsWithCloud(): Promise<boolean> {
  if (!(await canUseCloudFeatures())) return false;

  const storage = await getStorage();
  const result = await remoteSyncTracked(storage.trackedProducts);
  if (!result) return false;

  let changed = false;
  let tracked = storage.trackedProducts.map((p) =>
    p.id.startsWith('yandex_market-')
      ? { ...p, id: p.id.replace(/^yandex_market-/, 'yandex-') }
      : p,
  );
  if (tracked.some((p, i) => p.id !== storage.trackedProducts[i]?.id)) {
    changed = true;
  }

  // Удаления с других устройств
  if (result.removedKeys.length > 0) {
    const before = tracked.length;
    tracked = tracked.filter(
      (p) => !result.removedKeys.includes(`${p.marketplace}:${trackedKey(p)}`),
    );
    if (tracked.length !== before) changed = true;
  }

  // Обновления с сервера
  for (const remoteItem of result.updated) {
    const idx = tracked.findIndex(
      (p) =>
        p.marketplace === remoteItem.marketplace &&
        trackedKey(p) === trackedKey(remoteItem),
    );
    if (idx >= 0) {
      const merged = mergeTrackedFields(tracked[idx]!, remoteItem);
      if (JSON.stringify(merged) !== JSON.stringify(tracked[idx])) {
        tracked[idx] = merged;
        changed = true;
      }
    }
  }

  // Новые с других устройств
  const existingKeys = new Set(tracked.map((p) => `${p.marketplace}:${trackedKey(p)}`));
  const toAdd = result.incoming.filter(
    (p) => !existingKeys.has(`${p.marketplace}:${trackedKey(p)}`),
  );
  if (toAdd.length > 0) {
    tracked = [...toAdd, ...tracked];
    changed = true;
  }

  if (!changed) return false;

  const latest = await getStorage();
  await setStorage({ ...latest, trackedProducts: tracked });
  return true;
}

/** Проверить, достигнута ли целевая цена */
export function isTargetPriceReached(tracked: TrackedProduct, currentPrice: number): boolean {
  return Boolean(tracked.targetPrice && tracked.targetPrice > 0 && currentPrice <= tracked.targetPrice);
}
