/**
 * Upsert tracked product without relying on partial unique indexes.
 * PostgREST onConflict fails on UNIQUE INDEX ... WHERE user_id IS NOT NULL.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import type { Marketplace } from './marketplace-prices.ts';
import { appendPriceHistory } from './price-history.ts';

export interface TrackedUpsertInput {
  userId: string;
  marketplace: Marketplace | string;
  productId: string;
  productTitle?: string | null;
  productUrl?: string | null;
  targetPrice?: number | null;
  lastPrice?: number | null;
  lastChecked?: string | null;
  notes?: string | null;
  deleted?: boolean;
  updatedAt?: string;
}

export async function upsertTrackedProduct(
  supabase: SupabaseClient,
  input: TrackedUpsertInput,
): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const nowIso = input.updatedAt ?? new Date().toISOString();
  const row = {
    user_id: input.userId,
    marketplace: String(input.marketplace),
    product_id: String(input.productId).slice(0, 64),
    product_title: input.productTitle ? String(input.productTitle).slice(0, 500) : null,
    product_url: input.productUrl ? String(input.productUrl).slice(0, 2000) : null,
    target_price: input.targetPrice == null ? null : Number(input.targetPrice),
    last_price: input.lastPrice == null ? null : Number(input.lastPrice),
    last_checked: input.lastChecked ?? null,
    notes: input.notes ? String(input.notes).slice(0, 1000) : null,
    deleted: Boolean(input.deleted),
    updated_at: nowIso,
    device_id: null as string | null,
  };

  const { data: existing, error: findError } = await supabase
    .from('tracked_products')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('marketplace', row.marketplace)
    .eq('product_id', row.product_id)
    .maybeSingle();

  if (findError) {
    return { ok: false, error: findError.message, code: findError.code };
  }

  if (existing?.id) {
    const { error } = await supabase
      .from('tracked_products')
      .update(row)
      .eq('id', existing.id);
    if (error) return { ok: false, error: error.message, code: error.code };
    if (row.last_price != null && row.last_price > 0) {
      void appendPriceHistory(supabase, {
        userId: row.user_id,
        marketplace: row.marketplace,
        productId: row.product_id,
        price: row.last_price,
      });
    }
    return { ok: true };
  }

  const { error } = await supabase.from('tracked_products').insert(row);
  if (error) {
    // Race: unique violation → update
    if (error.code === '23505') {
      const { error: updErr } = await supabase
        .from('tracked_products')
        .update(row)
        .eq('user_id', row.user_id)
        .eq('marketplace', row.marketplace)
        .eq('product_id', row.product_id);
      if (updErr) return { ok: false, error: updErr.message, code: updErr.code };
      if (row.last_price != null && row.last_price > 0) {
        void appendPriceHistory(supabase, {
          userId: row.user_id,
          marketplace: row.marketplace,
          productId: row.product_id,
          price: row.last_price,
        });
      }
      return { ok: true };
    }
    return { ok: false, error: error.message, code: error.code };
  }

  if (row.last_price != null && row.last_price > 0) {
    void appendPriceHistory(supabase, {
      userId: row.user_id,
      marketplace: row.marketplace,
      productId: row.product_id,
      price: row.last_price,
    });
  }

  return { ok: true };
}
