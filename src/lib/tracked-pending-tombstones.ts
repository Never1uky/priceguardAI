import { cloudTrackedRowKey } from '@/lib/tracked-cloud-key';
import type { Marketplace } from '@/types/product';
import type { TombstoneKey } from '@/lib/tracked-reconcile';

const STORAGE_KEY = 'priceguard_tracked_pending_tombstones';

export async function getPendingTombstones(): Promise<TombstoneKey[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = stored[STORAGE_KEY] as TombstoneKey[] | undefined;
  return Array.isArray(list) ? list : [];
}

export async function addPendingTombstone(
  marketplace: Marketplace,
  productId: string,
): Promise<void> {
  const key = cloudTrackedRowKey(marketplace, productId);
  const current = await getPendingTombstones();
  if (current.some((p) => cloudTrackedRowKey(p.marketplace, p.productId) === key)) return;
  await chrome.storage.local.set({
    [STORAGE_KEY]: [...current, { marketplace, productId }],
  });
}

export async function clearPendingTombstones(keys: TombstoneKey[]): Promise<void> {
  if (keys.length === 0) return;
  const drop = new Set(keys.map((k) => cloudTrackedRowKey(k.marketplace, k.productId)));
  const current = await getPendingTombstones();
  const next = current.filter(
    (p) => !drop.has(cloudTrackedRowKey(p.marketplace, p.productId)),
  );
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
