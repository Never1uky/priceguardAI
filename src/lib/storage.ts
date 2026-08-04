/**
 * Tracked products + cloud sync (popup / service worker).
 * Content scripts must import `@/lib/storage-local` only — never this module.
 */

import {
  findTrackedMatchingProduct,
  getLastScrapedProduct,
  getPriceHistory,
  clearPriceHistory,
  getStorage,
  getTrackedProduct,
  getTrackedProducts,
  isProductTracked,
  recordPricePoint,
  recordVisitPrice,
  saveLastScrapedProduct,
  setStorage,
  updateTrackedProductPrice as updateTrackedProductPriceLocal,
} from '@/lib/storage-local';
import {
  productsIdentityMatch,
  resolveProductArticle,
  stableProductStorageId,
} from '@/lib/price-identity';
import { ensureProductImage, hydrateTrackedImages } from '@/lib/product-image';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import {
  pushTrackedProduct,
  pushTrackedTombstone,
  syncTrackedProducts as remoteSyncTracked,
} from '@/lib/supabase/tracked-sync';
import {
  clearCloudNetworkWarning,
} from '@/lib/supabase/cloud-reachability';
import { markOwnTrackedWriteQuietPeriod } from '@/lib/supabase/tracked-realtime';
import { cloudTrackedProductKey, cloudTrackedRowKey } from '@/lib/tracked-cloud-key';
import { addPendingTombstone } from '@/lib/tracked-pending-tombstones';
import type { Product, TrackedProduct } from '@/types/product';
import { toCanonicalProductUrl } from '@/utils/product-url';

export {
  getLastScrapedProduct,
  getPriceHistory,
  clearPriceHistory,
  getStorage,
  getTrackedProduct,
  getTrackedProducts,
  isProductTracked,
  recordPricePoint,
  recordVisitPrice,
  saveLastScrapedProduct,
  setStorage,
};

/** @deprecated use cloudTrackedProductKey */
function trackedKey(item: Parameters<typeof cloudTrackedProductKey>[0]): string {
  return cloudTrackedProductKey(item);
}

async function cloudPushTracked(tracked: TrackedProduct): Promise<void> {
  try {
    await pushTrackedProduct(tracked);
  } catch {
    // invalidated context — не мешаем основному сценарию
  }
}

async function cloudPushTombstone(
  marketplace: TrackedProduct['marketplace'],
  key: string,
): Promise<boolean> {
  try {
    return await pushTrackedTombstone(marketplace, key);
  } catch (error) {
    console.warn('[PriceGuard] tracked tombstone push failed:', error);
    return false;
  }
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
  const stableId = stableProductStorageId(product);
  const article = resolveProductArticle(product) || product.article;
  const normalized: Product = {
    ...product,
    id: stableId ?? product.id,
    article,
    url: toCanonicalProductUrl(product.url, product.marketplace),
  };
  const existing = storage.trackedProducts.find(
    (item) => productsIdentityMatch(item, normalized).ok || item.id === normalized.id,
  );

  if (existing) {
    return existing;
  }

  let withImage = normalized;
  try {
    withImage = await ensureProductImage(normalized, {
      force: !normalized.imageUrl,
    });
  } catch {
    // soft
  }

  const tracked: TrackedProduct = {
    ...withImage,
    trackedAt: Date.now(),
    initialPrice: withImage.price,
    lowestPrice: withImage.price,
    notificationsEnabled: true,
  };

  const history = storage.priceHistory[normalized.id] ?? [];
  const priceHistory = {
    ...storage.priceHistory,
    [normalized.id]: history.length
      ? history
      : [{ price: withImage.price, timestamp: Date.now() }],
  };

  await setStorage({
    ...storage,
    trackedProducts: [tracked, ...storage.trackedProducts],
    priceHistory,
  });

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

  if (removed) {
    const key = trackedKey(removed);
    await addPendingTombstone(removed.marketplace, key);
    const ok = await cloudPushTombstone(removed.marketplace, key);
    if (!ok) {
      console.warn('[PriceGuard] tombstone queued for retry:', removed.marketplace, key);
    }
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

/** Local update + cloud push (popup / SW). Content must use storage-local. */
export async function updateTrackedProductPrice(product: Product) {
  const priceChange = await updateTrackedProductPriceLocal(product);
  const updated = await findTrackedMatchingProduct(product);
  if (updated) void cloudPushTracked(updated);
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
  const imageUrl = local.imageUrl || remote.imageUrl;
  const imageUrlAlternatives =
    local.imageUrlAlternatives?.length
      ? local.imageUrlAlternatives
      : remote.imageUrlAlternatives;

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
 */
export async function syncTrackedProductsWithCloud(options?: {
  reconcile?: boolean;
}): Promise<boolean> {
  if (!(await canUseCloudFeatures())) return false;

  try {
    markOwnTrackedWriteQuietPeriod();
  } catch {
    // ignore
  }

  const storage = await getStorage();
  const result = await remoteSyncTracked(storage.trackedProducts, {
    reconcile: Boolean(options?.reconcile),
  });
  if (!result) return false;

  try {
    clearCloudNetworkWarning();
  } catch {
    // ignore
  }

  let changed = false;
  let tracked = storage.trackedProducts.map((p) =>
    p.id.startsWith('yandex_market-')
      ? { ...p, id: p.id.replace(/^yandex_market-/, 'yandex-') }
      : p,
  );
  if (tracked.some((p, i) => p.id !== storage.trackedProducts[i]?.id)) {
    changed = true;
  }

  if (result.removedKeys.length > 0) {
    const before = tracked.length;
    tracked = tracked.filter(
      (p) => !result.removedKeys.includes(cloudTrackedRowKey(p.marketplace, trackedKey(p))),
    );
    if (tracked.length !== before) changed = true;
  }

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

  const existingKeys = new Set(
    tracked.map((p) => cloudTrackedRowKey(p.marketplace, trackedKey(p))),
  );
  const toAdd = result.incoming.filter(
    (p) => !existingKeys.has(cloudTrackedRowKey(p.marketplace, trackedKey(p))),
  );
  if (toAdd.length > 0) {
    tracked = [...toAdd, ...tracked];
    changed = true;
  }

  if (changed) {
    const latest = await getStorage();
    await setStorage({ ...latest, trackedProducts: tracked });
  }

  try {
    const current = changed ? tracked : (await getStorage()).trackedProducts;
    void hydrateTrackedImages(current, async (updated) => {
      const latest = await getStorage();
      await setStorage({ ...latest, trackedProducts: updated });
    }).catch((error) => {
      console.warn('[PriceGuard] tracked image hydrate:', error);
    });
  } catch (error) {
    console.warn('[PriceGuard] tracked image hydrate:', error);
  }

  return changed;
}

/** Проверить, достигнута ли целевая цена */
export function isTargetPriceReached(tracked: TrackedProduct, currentPrice: number): boolean {
  return Boolean(tracked.targetPrice && tracked.targetPrice > 0 && currentPrice <= tracked.targetPrice);
}
