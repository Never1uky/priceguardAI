/**
 * Shared Telegram monitoring: coalesce tracked rows into one scrape job per SKU.
 *
 * Preferred mental model (Phase 4): PRODUCT → JOB → SCRAPE → fan-out to subscriptions.
 * Physical model: per-user `tracked_products` + this coalesce (no separate product table).
 * See docs/audits/PHASE4_SHARED_MONITORING_DECISION.md.
 *
 * Dedup key (Phase 5): resolveMonitoringKey — marketplace+product_id, URL fallback, never title.
 */

import {
  isCoreMonitoringMarketplace,
  resolveMonitoringKey,
} from './monitoring-key.ts';
import type { Marketplace } from './product-url.ts';

export { isCoreMonitoringMarketplace };

export interface CoalesceTrackedItem<TRow> {
  row: TRow;
  priority: boolean;
}

export interface SkuMonitorGroup<TRow> {
  /** Canonical `marketplace:bareProductId` */
  key: string;
  marketplace: Marketplace;
  /** Bare article — pass to fetch / cache */
  productId: string;
  productUrl: string | null;
  /** True if any subscriber is Premium (drives freshness tier) */
  priority: boolean;
  rows: Array<CoalesceTrackedItem<TRow>>;
}

export type CoalesceRowFields = {
  marketplace: string;
  product_id: string;
  product_url?: string | null;
  product_title?: string | null;
};

/**
 * Group work-queue items by canonical monitoring key.
 * Non-core / unresolvable rows are dropped (no Scrappey job).
 */
export function coalesceTrackedSkuGroups<TRow extends CoalesceRowFields>(
  workQueue: Array<CoalesceTrackedItem<TRow>>,
): SkuMonitorGroup<TRow>[] {
  const skuGroups = new Map<string, SkuMonitorGroup<TRow>>();

  for (const item of workQueue) {
    const resolved = resolveMonitoringKey({
      marketplace: item.row.marketplace,
      productId: item.row.product_id,
      productUrl: item.row.product_url,
      title: item.row.product_title,
    });
    if (!resolved) continue;

    const existing = skuGroups.get(resolved.key);
    if (existing) {
      existing.rows.push(item);
      existing.priority = existing.priority || item.priority;
      if (!existing.productUrl && item.row.product_url) {
        existing.productUrl = item.row.product_url;
      }
    } else {
      skuGroups.set(resolved.key, {
        key: resolved.key,
        marketplace: resolved.marketplace,
        productId: resolved.productId,
        productUrl: item.row.product_url ?? null,
        priority: item.priority,
        rows: [item],
      });
    }
  }

  return [...skuGroups.values()];
}

/**
 * Active subscriber rows for a monitoring key after soft-deletes.
 * Empty ⇒ cron must not scrape that SKU (last subscriber gone).
 */
export function activeSubscriberCount<TRow extends { deleted?: boolean | null }>(
  rows: TRow[],
): number {
  return rows.filter((r) => r.deleted !== true).length;
}
