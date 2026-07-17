/**
 * Supabase Realtime — мгновенная синхронизация tracked_products между устройствами.
 *
 * Требует:
 *  - авторизацию (JWT в Supabase client)
 *  - publication supabase_realtime для tracked_products (миграция)
 *  - RLS: пользователь видит только свои строки
 */

import { getSupabaseAuthClient } from '@/lib/supabase/auth';
import type { RealtimeChannel } from '@supabase/supabase-js';

let activeChannel: RealtimeChannel | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Подписаться на изменения tracked_products пользователя.
 * @param userId auth.users.id
 * @param onChange колбэк (debounced 500ms)
 */
export function startTrackedProductsRealtime(
  userId: string,
  onChange: () => void,
): void {
  stopTrackedProductsRealtime();

  const supabase = getSupabaseAuthClient();
  if (!supabase || !userId) return;

  const debounced = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 500);
  };

  activeChannel = supabase
    .channel(`tracked-products-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'tracked_products',
        filter: `user_id=eq.${userId}`,
      },
      () => {
        console.info('[PriceGuard] Realtime: tracked_products changed');
        debounced();
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.info('[PriceGuard] Realtime subscribed for user', userId.slice(0, 8));
      }
      if (status === 'CHANNEL_ERROR') {
        console.warn('[PriceGuard] Realtime channel error');
      }
    });
}

export function stopTrackedProductsRealtime(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const supabase = getSupabaseAuthClient();
  if (activeChannel && supabase) {
    void supabase.removeChannel(activeChannel);
  }
  activeChannel = null;
}
