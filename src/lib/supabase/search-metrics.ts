/**
 * Клиентский слой метрик поиска (Supabase search_metrics).
 * Fire-and-forget: логируем каждый кросс-маркетплейс поиск, чтобы
 * ловить регрессы (например, когда ломается поиск по WB).
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { getDeviceId } from '@/lib/supabase/device-id';
import { getSupabaseConfig } from '@/lib/supabase/config';
import type { Marketplace } from '@/types/product';

export interface SearchMetricInput {
  marketplace: Marketplace;
  searchQuery: string;
  success: boolean;
  responseTimeMs?: number;
  foundProductId?: string;
}

/** Отправить метрику поиска. Не бросает и не блокирует основной поток. */
export async function logSearchMetric(input: SearchMetricInput): Promise<void> {
  if (!getSupabaseConfig().configured) return;

  try {
    const deviceId = await getDeviceId();
    await callEdgeSafe('search-metrics', {
      marketplace: input.marketplace,
      searchQuery: input.searchQuery,
      success: input.success,
      responseTimeMs: input.responseTimeMs,
      foundProductId: input.foundProductId,
      deviceId,
    });
  } catch {
    // метрики не должны влиять на UX
  }
}
