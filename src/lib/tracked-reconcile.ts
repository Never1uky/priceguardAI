import { cloudTrackedProductKey, cloudTrackedRowKey } from '@/lib/tracked-cloud-key';
import type { Marketplace, TrackedProduct } from '@/types/product';

export interface RemoteTrackedRowLike {
  marketplace: Marketplace;
  product_id: string;
  deleted?: boolean;
}

export interface TombstoneKey {
  marketplace: Marketplace;
  productId: string;
}

/** Server-only active rows → tombstone when extension list is authoritative. */
export function computeReconcileTombstones(
  local: TrackedProduct[],
  remote: RemoteTrackedRowLike[],
): TombstoneKey[] {
  const localKeys = new Set(
    local.map((p) => cloudTrackedRowKey(p.marketplace, cloudTrackedProductKey(p))),
  );

  const seen = new Set<string>();
  const out: TombstoneKey[] = [];

  for (const row of remote) {
    if (row.deleted) continue;
    const key = cloudTrackedRowKey(row.marketplace, row.product_id);
    if (localKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ marketplace: row.marketplace, productId: row.product_id });
  }

  return out;
}

export function mergeTombstoneKeys(...lists: TombstoneKey[][]): TombstoneKey[] {
  const seen = new Set<string>();
  const out: TombstoneKey[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = cloudTrackedRowKey(item.marketplace, item.productId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function isPendingTombstone(
  row: RemoteTrackedRowLike,
  pending: TombstoneKey[],
): boolean {
  const key = cloudTrackedRowKey(row.marketplace, row.product_id);
  return pending.some(
    (p) => cloudTrackedRowKey(p.marketplace, p.productId) === key,
  );
}
