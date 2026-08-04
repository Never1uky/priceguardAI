/**
 * Supabase Realtime — мгновенная синхронизация tracked_products между устройствами.
 *
 * Требует:
 *  - авторизацию (JWT в Supabase client)
 *  - publication supabase_realtime для tracked_products (миграция)
 *  - RLS: пользователь видит только свои строки
 *
 * Storm guard: debounce + ignore window after own push + cooldown between syncs.
 */

import { getSupabaseAuthClient } from '@/lib/supabase/auth';
import {
  clearCloudNetworkWarning,
  noteCloudNetworkFailure,
} from '@/lib/supabase/cloud-reachability';
import type { RealtimeChannel } from '@supabase/supabase-js';

export const REALTIME_DEBOUNCE_MS = 1_800;
export const REALTIME_IGNORE_AFTER_PUSH_MS = 2_000;
export const REALTIME_SYNC_COOLDOWN_MS = 3_000;

let activeChannel: RealtimeChannel | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingChangeCount = 0;
let ignoreRealtimeUntil = 0;
let syncInFlight = false;
let lastSyncStartedAt = 0;
let channelErrorBackoffUntil = 0;

/** Pure: skip echo from our own push/upsert. */
export function shouldIgnoreRealtimeEvent(
  now: number,
  ignoreUntil: number,
): boolean {
  return now < ignoreUntil;
}

/** Pure: block overlapping / too-frequent sync starts. */
export function canStartTrackedCloudSync(
  now: number,
  inFlight: boolean,
  lastStartedAt: number,
  cooldownMs: number,
): boolean {
  if (inFlight) return false;
  if (lastStartedAt > 0 && now - lastStartedAt < cooldownMs) return false;
  return true;
}

/** Перед push/upsert tracked — Realtime-события от своего write не триггерят re-sync. */
export function markOwnTrackedWriteQuietPeriod(
  ms = REALTIME_IGNORE_AFTER_PUSH_MS,
): void {
  ignoreRealtimeUntil = Date.now() + ms;
}

/**
 * Начать cloud sync из Realtime (или вручную с guard).
 * @returns false если skip (in-flight / cooldown)
 */
export function beginTrackedCloudSyncFromRealtime(): boolean {
  const now = Date.now();
  if (now < channelErrorBackoffUntil) return false;
  if (!canStartTrackedCloudSync(now, syncInFlight, lastSyncStartedAt, REALTIME_SYNC_COOLDOWN_MS)) {
    return false;
  }
  syncInFlight = true;
  lastSyncStartedAt = now;
  markOwnTrackedWriteQuietPeriod();
  return true;
}

export function endTrackedCloudSyncFromRealtime(ok: boolean): void {
  syncInFlight = false;
  if (ok) clearCloudNetworkWarning();
}

/**
 * Подписаться на изменения tracked_products пользователя.
 * @param userId auth.users.id
 * @param onChange колбэк (debounced; сам вызывающий должен begin/end sync)
 */
export function startTrackedProductsRealtime(
  userId: string,
  onChange: () => void,
): void {
  stopTrackedProductsRealtime();

  const supabase = getSupabaseAuthClient();
  if (!supabase || !userId) return;

  const flush = () => {
    debounceTimer = null;
    const n = pendingChangeCount;
    pendingChangeCount = 0;
    if (n <= 0) return;
    if (shouldIgnoreRealtimeEvent(Date.now(), ignoreRealtimeUntil)) {
      return;
    }
    console.info(`[PriceGuard] Realtime: sync after ${n} tracked change(s)`);
    onChange();
  };

  const debounced = () => {
    pendingChangeCount += 1;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, REALTIME_DEBOUNCE_MS);
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
        if (shouldIgnoreRealtimeEvent(Date.now(), ignoreRealtimeUntil)) {
          return;
        }
        debounced();
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channelErrorBackoffUntil = 0;
        console.info('[PriceGuard] Realtime subscribed for user', userId.slice(0, 8));
      }
      if (status === 'CHANNEL_ERROR') {
        channelErrorBackoffUntil = Date.now() + 10_000;
        noteCloudNetworkFailure('realtime');
      }
    });
}

export function stopTrackedProductsRealtime(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingChangeCount = 0;
  const supabase = getSupabaseAuthClient();
  if (activeChannel && supabase) {
    void supabase.removeChannel(activeChannel);
  }
  activeChannel = null;
}
