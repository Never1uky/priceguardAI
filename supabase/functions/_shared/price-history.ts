/**
 * Append price points to product_price_history (dedupe ~30 min same price).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DEDUPE_MS = 30 * 60 * 1000;

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
      Date.now() - prevAt < DEDUPE_MS
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
