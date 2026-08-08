/**
 * Append / load price points for product_price_history.
 *
 * Server retention: public.compact_price_history() keeps full resolution for
 * 30 days, then weekly min+max (30d–1y), then monthly min+max (1y+). See
 * supabase/migrations/20260808170000_compact_price_history.sql.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/** Skip insert when the same price was recorded within this window. */
export const PRICE_HISTORY_DEDUPE_MS = 30 * 60 * 1000;

export async function appendPriceHistory(
  supabase: SupabaseClient,
  params: {
    userId: string;
    marketplace: string;
    productId: string;
    price: number;
  },
): Promise<void> {
  if (!params.userId || !params.productId || !(params.price > 0)) return;

  const { data: last } = await supabase
    .from('product_price_history')
    .select('price, recorded_at')
    .eq('user_id', params.userId)
    .eq('marketplace', params.marketplace)
    .eq('product_id', params.productId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last) {
    const prevPrice = Number(last.price);
    const prevAt = Date.parse(String(last.recorded_at));
    if (
      prevPrice === params.price &&
      Number.isFinite(prevAt) &&
      Date.now() - prevAt < PRICE_HISTORY_DEDUPE_MS
    ) {
      return;
    }
  }

  const { error } = await supabase.from('product_price_history').insert({
    user_id: params.userId,
    marketplace: params.marketplace,
    product_id: params.productId,
    price: params.price,
    recorded_at: new Date().toISOString(),
  });

  if (error) {
    console.warn('[price-history] insert', error.message);
  }
}

export async function loadPriceHistory(
  supabase: SupabaseClient,
  params: {
    userId: string;
    marketplace: string;
    productId: string;
    limit?: number;
  },
): Promise<Array<{ price: number; recordedAt: string }>> {
  const { data, error } = await supabase
    .from('product_price_history')
    .select('price, recorded_at')
    .eq('user_id', params.userId)
    .eq('marketplace', params.marketplace)
    .eq('product_id', params.productId)
    .order('recorded_at', { ascending: false })
    .limit(params.limit ?? 20);

  if (error || !data) return [];
  return data.map((r) => ({
    price: Number(r.price),
    recordedAt: String(r.recorded_at),
  })).reverse();
}
