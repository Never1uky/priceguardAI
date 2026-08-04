/**
 * Двусторонняя синхронизация списка сравнения через Supabase Auth.
 * On Edge failure, push is queued in PendingSync outbox.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { getSupabaseConfig } from '@/lib/supabase/config';
import type { CompareProduct } from '@/types/comparison';
import {
  findDuplicateCompareProduct,
  mergeCompareProducts,
} from '@/lib/compare-merge';
import {
  enqueuePendingSync,
  registerPendingSyncHandler,
  type PendingSyncItem,
} from '@/lib/pending-sync';

const TOMBSTONE_KEY = 'priceguard_compare_deleted_ids';
const COMPARE_STORAGE_KEY = 'priceguard_compare_products';

interface RemoteCompareRow {
  product_id: string;
  payload: CompareProduct | Record<string, unknown>;
  deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

function isValidPayload(p: unknown): p is CompareProduct {
  if (!p || typeof p !== 'object') return false;
  const c = p as CompareProduct;
  return Boolean(c.id && c.title && c.sourceUrl && c.sourceMarketplace);
}

export async function getCompareDeletedIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(TOMBSTONE_KEY);
  const list = stored[TOMBSTONE_KEY];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

export async function markCompareDeleted(id: string): Promise<void> {
  const ids = await getCompareDeletedIds();
  if (ids.includes(id)) return;
  await chrome.storage.local.set({ [TOMBSTONE_KEY]: [...ids, id].slice(-200) });
}

export async function clearCompareDeleted(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  const remaining = (await getCompareDeletedIds()).filter((id) => !set.has(id));
  await chrome.storage.local.set({ [TOMBSTONE_KEY]: remaining });
}

function consolidate(products: CompareProduct[]): CompareProduct[] {
  const result: CompareProduct[] = [];
  for (const product of products) {
    const duplicate = findDuplicateCompareProduct(result, product);
    if (duplicate) {
      const index = result.findIndex((p) => p.id === duplicate.id);
      result[index] = mergeCompareProducts(result[index], product);
    } else {
      result.push(product);
    }
  }
  return result;
}

function buildPushItems(local: CompareProduct[], deletedIds: string[]) {
  return [
    ...local.map((p) => ({
      productId: p.id,
      payload: p,
      deleted: false,
      updatedAt: p.comparedAt ?? p.addedAt ?? Date.now(),
    })),
    ...deletedIds.map((id) => ({
      productId: id,
      payload: {},
      deleted: true,
      updatedAt: Date.now(),
    })),
  ];
}

function mergeRemote(
  local: CompareProduct[],
  res: { items: RemoteCompareRow[] },
): CompareProduct[] {
  const remoteActive = res.items
    .filter((r) => !r.deleted && isValidPayload(r.payload))
    .map((r) => {
      const p = r.payload as CompareProduct;
      return { ...p, id: p.id || r.product_id };
    });

  const remoteDeleted = new Set(res.items.filter((r) => r.deleted).map((r) => r.product_id));
  const keptLocal = local.filter((p) => !remoteDeleted.has(p.id));
  // Local first so mergeCompareProducts(existing=local, incoming=remote) keeps
  // pending needs_choice over stale remote not_found (see preferRicherMarketplaceOffer).
  return consolidate([...keptLocal, ...remoteActive]);
}

/** Push local + pull remote; returns merged list to save locally (or null if skipped/failed). */
export async function syncCompareProductsWithCloud(
  local: CompareProduct[],
): Promise<CompareProduct[] | null> {
  if (!getSupabaseConfig().configured) return null;
  if (!(await canUseCloudFeatures())) return null;

  const deletedIds = await getCompareDeletedIds();
  const items = buildPushItems(local, deletedIds);

  const res = await callEdgeSafe<{ ok: boolean; items?: RemoteCompareRow[] }>('compare-sync', {
    action: 'push',
    items,
  });

  if (!res?.ok || !Array.isArray(res.items)) {
    await enqueuePendingSync('compare_sync', 'compare_sync:full', {
      products: local,
      deletedIds,
    });
    return null;
  }

  await clearCompareDeleted(deletedIds);
  return mergeRemote(local, { items: res.items });
}

registerPendingSyncHandler('compare_sync', async (item: PendingSyncItem) => {
  if (!(await canUseCloudFeatures())) return 'retry';
  const payload = item.payload as {
    products?: CompareProduct[];
    deletedIds?: string[];
  };
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const deletedIds =
    Array.isArray(payload?.deletedIds) && payload.deletedIds.length
      ? payload.deletedIds
      : await getCompareDeletedIds();

  const res = await callEdgeSafe<{ ok: boolean; items?: RemoteCompareRow[] }>('compare-sync', {
    action: 'push',
    items: buildPushItems(products, deletedIds),
  });

  if (!res?.ok || !Array.isArray(res.items)) return 'retry';

  await clearCompareDeleted(deletedIds);
  const merged = mergeRemote(products, { items: res.items });
  try {
    await chrome.storage.local.set({ [COMPARE_STORAGE_KEY]: merged });
  } catch {
    // local write best-effort
  }
  return 'ok';
});
