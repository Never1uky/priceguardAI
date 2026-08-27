/**
 * Shared price scrape cache (6h TTL) via Edge price-cache.
 * Same table as Telegram cron (`price_scrape_cache`) — not AI product_cache.
 * Puts go through PendingSync outbox so 502 never loses data.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { getSupabaseConfig } from '@/lib/supabase/config';
import {
  enqueuePendingSync,
  registerPendingSyncHandler,
  type PendingSyncItem,
} from '@/lib/pending-sync';
import type { ComparisonMarketplace } from '@/types/comparison';

export async function getSharedPriceCache(
  marketplace: ComparisonMarketplace,
  productId: string,
): Promise<{ price: number; title?: string; url: string; rating?: number | null } | null> {
  if (!productId || !getSupabaseConfig().configured) return null;
  if (!(await canUseCloudFeatures())) return null;

  const res = await callEdgeSafe<{
    ok?: boolean;
    hit?: boolean;
    price?: number;
    title?: string | null;
    url?: string;
    rating?: number | null;
  }>('price-cache', {
    action: 'get',
    marketplace,
    productId,
  });

  if (!res?.ok || !res.hit || !res.price || res.price <= 0) return null;
  return {
    price: res.price,
    title: res.title ?? undefined,
    url: res.url ?? '',
    rating: res.rating ?? null,
  };
}

async function putPriceCacheViaEdge(payload: {
  marketplace: ComparisonMarketplace;
  productId: string;
  price: number;
  title?: string;
  url: string;
  rating?: number | null;
}): Promise<boolean> {
  const res = await callEdgeSafe<{ ok?: boolean }>('price-cache', {
    action: 'put',
    marketplace: payload.marketplace,
    productId: payload.productId,
    price: payload.price,
    title: payload.title,
    url: payload.url,
    rating: payload.rating ?? null,
  });
  return Boolean(res?.ok);
}

export async function putSharedPriceCache(input: {
  marketplace: ComparisonMarketplace;
  productId: string;
  price: number;
  title?: string;
  url: string;
  rating?: number | null;
}): Promise<void> {
  if (!input.productId || !input.price || !input.url) return;
  if (!getSupabaseConfig().configured) return;
  if (!(await canUseCloudFeatures())) return;

  const ok = await putPriceCacheViaEdge(input);
  if (ok) return;

  await enqueuePendingSync(
    'price_cache_put',
    `price_cache:${input.marketplace}:${input.productId}`,
    input,
  );
}

registerPendingSyncHandler('price_cache_put', async (item: PendingSyncItem) => {
  const payload = item.payload as {
    marketplace: ComparisonMarketplace;
    productId: string;
    price: number;
    title?: string;
    url: string;
    rating?: number | null;
  };
  if (!payload?.productId || !payload.price) return 'drop';
  if (!(await canUseCloudFeatures())) return 'retry';
  const ok = await putPriceCacheViaEdge(payload);
  return ok ? 'ok' : 'retry';
});
