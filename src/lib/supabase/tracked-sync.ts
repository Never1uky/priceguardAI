/**
 * Двусторонняя синхронизация отслеживаемых товаров через Supabase Auth (user_id).
 *
 * Требует авторизации. JWT передаётся автоматически через edge-auth.
 * Tombstone (deleted) синхронизирует удаления между устройствами.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { buildWildberriesUrl } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import type { Marketplace, TrackedProduct } from '@/types/product';

interface RemoteTrackedRow {
  marketplace: Marketplace;
  product_id: string;
  product_title?: string | null;
  product_url?: string | null;
  target_price?: number | null;
  last_price?: number | null;
  last_checked?: string | null;
  notes?: string | null;
  deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

function productKey(item: { article?: string; id: string }): string {
  return (item.article && item.article.trim()) || item.id;
}

/** Локальный id как у content-парсеров: wb- / ozon- / yandex- */
function localProductId(marketplace: Marketplace, productId: string): string {
  if (marketplace === 'wildberries') return `wb-${productId}`;
  if (marketplace === 'ozon') return `ozon-${productId}`;
  return `yandex-${productId}`;
}

function reconstructYmUrl(productId: string, productUrl?: string | null): string {
  if (productUrl && /market\.yandex\.ru\/card\//i.test(productUrl)) {
    return toCanonicalProductUrl(productUrl, 'yandex_market');
  }
  return toCanonicalProductUrl(
    `https://market.yandex.ru/product/${productId}`,
    'yandex_market',
  );
}

function reconstructUrl(
  marketplace: Marketplace,
  productId: string,
  productUrl?: string | null,
): string {
  if (marketplace === 'wildberries') {
    return buildWildberriesUrl(productId);
  }
  if (marketplace === 'ozon') {
    return toCanonicalProductUrl(`https://www.ozon.ru/product/${productId}/`, 'ozon');
  }
  return reconstructYmUrl(productId, productUrl);
}

function toLocalTracked(row: RemoteTrackedRow): TrackedProduct {
  const price = Number(row.last_price ?? 0);
  const productId = row.product_id;
  return {
    id: localProductId(row.marketplace, productId),
    marketplace: row.marketplace,
    title: row.product_title ?? 'Товар',
    price,
    currency: '₽',
    article: productId,
    url: row.product_url?.startsWith('http')
      ? row.product_url
      : reconstructUrl(row.marketplace, productId, row.product_url),
    scrapedAt: row.last_checked ? Date.parse(row.last_checked) : Date.now(),
    trackedAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    initialPrice: price,
    lowestPrice: price,
    targetPrice: row.target_price == null ? undefined : Number(row.target_price),
    notes: row.notes ?? undefined,
  };
}

function toRemotePayload(
  local: TrackedProduct[],
  deletedKeys: { marketplace: Marketplace; productId: string }[],
) {
  const items = local.map((p) => ({
    marketplace: p.marketplace,
    productId: productKey(p),
    productTitle: p.title,
    targetPrice: p.targetPrice ?? null,
    lastPrice: p.price,
    lastChecked: p.scrapedAt,
    notes: p.notes ?? null,
    productUrl: p.url ?? null,
    updatedAt: Date.now(),
    deleted: false,
  }));

  const tombstones = deletedKeys.map((d) => ({
    marketplace: d.marketplace,
    productId: d.productId,
    deleted: true,
    updatedAt: Date.now(),
  }));

  return [...items, ...tombstones];
}

export interface SyncResult {
  incoming: TrackedProduct[];
  remote: RemoteTrackedRow[];
  /** Удалённые на сервере — убрать локально */
  removedKeys: string[];
  /** Обновлённые с сервера (цена, target, notes) */
  updated: TrackedProduct[];
}

export async function syncTrackedProducts(
  local: TrackedProduct[],
  deletedKeys: { marketplace: Marketplace; productId: string }[] = [],
): Promise<SyncResult | null> {
  if (!getSupabaseConfig().configured) return null;
  if (!(await canUseCloudFeatures())) return null;

  const pushed = await callEdgeSafe<{ ok: boolean; items: RemoteTrackedRow[] }>('tracked-sync', {
    action: 'push',
    items: toRemotePayload(local, deletedKeys),
  });

  const remote = pushed?.items ?? [];
  const localKeys = new Set(local.map((p) => `${p.marketplace}:${productKey(p)}`));

  const incoming = remote
    .filter((r) => !r.deleted && !localKeys.has(`${r.marketplace}:${r.product_id}`))
    .map(toLocalTracked);

  const removedKeys = remote
    .filter((r) => r.deleted)
    .map((r) => `${r.marketplace}:${r.product_id}`);

  const updated: TrackedProduct[] = [];
  for (const row of remote.filter((r) => !r.deleted)) {
    const key = `${row.marketplace}:${row.product_id}`;
    if (localKeys.has(key)) {
      updated.push(toLocalTracked(row));
    }
  }

  return { incoming, remote, removedKeys, updated };
}

export async function pushTrackedProduct(product: TrackedProduct): Promise<void> {
  if (!getSupabaseConfig().configured || !(await canUseCloudFeatures())) return;
  await callEdgeSafe('tracked-sync', {
    action: 'push',
    items: [
      {
        marketplace: product.marketplace,
        productId: productKey(product),
        productTitle: product.title,
        targetPrice: product.targetPrice ?? null,
        lastPrice: product.price,
        lastChecked: product.scrapedAt,
        notes: product.notes ?? null,
        productUrl: product.url ?? null,
        updatedAt: Date.now(),
        deleted: false,
      },
    ],
  });
}

export async function pushTrackedTombstone(
  marketplace: Marketplace,
  productId: string,
): Promise<void> {
  if (!getSupabaseConfig().configured || !(await canUseCloudFeatures())) return;
  await callEdgeSafe('tracked-sync', {
    action: 'push',
    items: [{ marketplace, productId, deleted: true, updatedAt: Date.now() }],
  });
}
