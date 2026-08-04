/**
 * Min price over 30/90/365 days from product_price_history + status labels.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { productIdLookupCandidates } from './product-id.ts';
import type { Marketplace } from './product-url.ts';

export type PriceMinWindow = {
  min30: number | null;
  min90: number | null;
  min365: number | null;
  points90: number;
};

export type PriceMinStatus =
  | 'near_min'
  | 'below_avg'
  | 'above_avg'
  | 'far'
  | 'insufficient';

export function classifyPriceVsMin90(
  priceNow: number,
  min90: number | null,
  points90: number,
): { status: PriceMinStatus; pct: number | null; label: string } {
  if (points90 < 3 || min90 == null || !(min90 > 0) || !(priceNow > 0)) {
    return { status: 'insufficient', pct: null, label: 'Мало данных по минимуму' };
  }
  const pct = ((priceNow - min90) / min90) * 100;
  if (pct <= 3) {
    return { status: 'near_min', pct, label: 'Цена близка к минимуму' };
  }
  if (pct <= 10) {
    return { status: 'below_avg', pct, label: 'Ниже среднего' };
  }
  if (pct <= 25) {
    return { status: 'above_avg', pct, label: 'Выше среднего' };
  }
  return { status: 'far', pct, label: 'Далеко от минимума' };
}

function asMarketplace(raw: string): Marketplace | null {
  if (raw === 'wildberries' || raw === 'ozon' || raw === 'yandex_market') return raw;
  return null;
}

export async function loadPriceMins(
  supabase: SupabaseClient,
  params: {
    userId: string;
    marketplace: string;
    productId: string;
  },
): Promise<PriceMinWindow> {
  const since365 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const mp = asMarketplace(params.marketplace);
  const idCandidates = mp
    ? productIdLookupCandidates(mp, params.productId)
    : [params.productId].filter(Boolean);
  if (idCandidates.length === 0) {
    return { min30: null, min90: null, min365: null, points90: 0 };
  }
  const { data, error } = await supabase
    .from('product_price_history')
    .select('price, recorded_at')
    .eq('user_id', params.userId)
    .eq('marketplace', params.marketplace)
    .in('product_id', idCandidates)
    .gte('recorded_at', since365)
    .order('recorded_at', { ascending: false })
    .limit(500);

  if (error || !data?.length) {
    return { min30: null, min90: null, min365: null, points90: 0 };
  }

  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const d90 = now - 90 * 24 * 60 * 60 * 1000;

  let min30: number | null = null;
  let min90: number | null = null;
  let min365: number | null = null;
  let points90 = 0;

  for (const row of data) {
    const price = Number(row.price);
    if (!(price > 0)) continue;
    const at = Date.parse(String(row.recorded_at));
    if (!Number.isFinite(at)) continue;
    min365 = min365 == null ? price : Math.min(min365, price);
    if (at >= d90) {
      points90 += 1;
      min90 = min90 == null ? price : Math.min(min90, price);
    }
    if (at >= d30) {
      min30 = min30 == null ? price : Math.min(min30, price);
    }
  }

  return { min30, min90, min365, points90 };
}

export function formatMinStatusLine(
  priceNow: number | null | undefined,
  mins: PriceMinWindow,
): string | null {
  if (priceNow == null || !(priceNow > 0)) return null;
  const cls = classifyPriceVsMin90(priceNow, mins.min90, mins.points90);
  const parts: string[] = [`📉 ${cls.label}`];
  if (mins.min90 != null) {
    parts.push(
      `min90: ${new Intl.NumberFormat('ru-RU').format(Math.round(mins.min90))} ₽`,
    );
  }
  return parts.join(' · ');
}
