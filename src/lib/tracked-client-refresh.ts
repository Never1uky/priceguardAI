/**
 * Who owns price refresh: Telegram cron (CORE trio) vs client (Mega / Ali / M.Video / test MPs).
 * MEGA-6 / ALI-6 / MVIDEO-6: never skip Mega/Ali/M.Video because server_monitoring is on —
 * cron does not scrape them.
 */

import { isCronPriceMonitoredMarketplace } from '@/lib/marketplaces/registry';
import type { CompareProduct } from '@/types/comparison';

export const CLIENT_TRACKED_STALE_MS = 8 * 60 * 60 * 1000;

export function selectTrackedForClientRefresh<T extends { marketplace: string; scrapedAt?: number }>(
  tracked: T[],
  opts: {
    force?: boolean;
    serverMonitoringActive: boolean;
    now?: number;
    staleMs?: number;
  },
): T[] {
  if (opts.force || !opts.serverMonitoringActive) return [...tracked];
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? CLIENT_TRACKED_STALE_MS;
  return tracked.filter((p) => {
    if (!isCronPriceMonitoredMarketplace(p.marketplace)) return true;
    const checkedAt = p.scrapedAt;
    if (!checkedAt || !Number.isFinite(checkedAt) || checkedAt <= 0) return true;
    return now - checkedAt >= staleMs;
  });
}

export function compareProductNeedsClientRefresh(
  product: Pick<CompareProduct, 'sourceMarketplace' | 'comparedAt' | 'marketplaceUrls' | 'marketplaceOffers'>,
  opts: {
    force?: boolean;
    serverMonitoringActive: boolean;
    now?: number;
    staleMs?: number;
  },
): boolean {
  if (opts.force || !opts.serverMonitoringActive) return true;
  if (
    product.sourceMarketplace &&
    !isCronPriceMonitoredMarketplace(product.sourceMarketplace)
  ) {
    return true;
  }
  for (const [mp, url] of Object.entries(product.marketplaceUrls ?? {})) {
    if (url && !isCronPriceMonitoredMarketplace(mp)) return true;
  }
  for (const [mp, offer] of Object.entries(product.marketplaceOffers ?? {})) {
    if (offer?.url && !isCronPriceMonitoredMarketplace(mp)) return true;
  }
  const at = product.comparedAt;
  if (!at || !Number.isFinite(at) || at <= 0) return true;
  return (opts.now ?? Date.now()) - at >= (opts.staleMs ?? CLIENT_TRACKED_STALE_MS);
}
