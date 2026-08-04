/**
 * Хуки после успешного входа / кнопка «Синхронизировать»:
 * 1. Claim legacy tracked_products (device_id → user_id) — один раз на пользователя
 * 2. Параллельно: tracked sync, compare sync, premium restore, alert settings
 * 3. Realtime-подписка на tracked_products
 *
 * Hydrate картинок — внутри sync* (fire-and-forget), не держит этот путь.
 * Research / compare-поиск сюда не входят.
 */

import { claimDeviceTrackedProducts } from '@/lib/supabase/claim-device';
import { getAuthSession, getAuthUser } from '@/lib/supabase/auth';
import { getDeviceId } from '@/lib/supabase/device-id';
import { syncTrackedProductsWithCloud, getStorage } from '@/lib/storage';
import { syncCompareProductsFromCloud } from '@/lib/comparison-storage';
import {
  beginTrackedCloudSyncFromRealtime,
  endTrackedCloudSyncFromRealtime,
  startTrackedProductsRealtime,
  stopTrackedProductsRealtime,
} from '@/lib/supabase/tracked-realtime';
import { pullAlertSettingsFromCloud, syncAlertSettingsToCloud } from '@/lib/supabase/alert-settings-sync';
import { restorePremiumFromAccount } from '@/lib/subscription';

const CLAIM_KEY_PREFIX = 'priceguard_claim_done_';
/** Soft budget for the whole cloud sync (button spinner should finish within this). */
const POST_LOGIN_TOTAL_TIMEOUT_MS = 25_000;
/** Claim alone — keep short so the rest of the budget remains for parallel steps. */
const CLAIM_TIMEOUT_MS = 8_000;
/** Reuse a just-finished result so signIn + SIGNED_IN don't double-hit the network. */
const REUSE_RESULT_MS = 4_000;

export interface PostLoginResult {
  /** Сколько legacy-записей в облаке привязано к аккаунту */
  claimed: number;
  /** Сколько дубликатов удалено при claim */
  merged: number;
  /** Локальный список изменён после sync */
  synced: boolean;
  /** Список сравнения обновлён с облака */
  compareSynced: boolean;
  /** Сколько товаров было локально до sync */
  localCount: number;
  /** Claim уже выполнялся ранее */
  claimSkipped: boolean;
  /** Premium восстановлен из user_premium */
  premiumRestored: boolean;
  /** Telegram-настройки восстановлены из user_alert_settings */
  telegramRestored: boolean;
  /** Soft timeout / network failure on a cloud step */
  timedOut?: boolean;
  error?: string;
}

export interface RunPostLoginOptions {
  /** Кнопка Sync — всегда свежий проход, без reuse кэша */
  force?: boolean;
}

let postLoginInFlight: Promise<PostLoginResult> | null = null;
let lastCompleted: { at: number; result: PostLoginResult } | null = null;

function claimStorageKey(userId: string): string {
  return `${CLAIM_KEY_PREFIX}${userId}`;
}

function emptyResult(partial?: Partial<PostLoginResult>): PostLoginResult {
  return {
    claimed: 0,
    merged: 0,
    synced: false,
    compareSynced: false,
    localCount: 0,
    claimSkipped: true,
    premiumRestored: false,
    telegramRestored: false,
    ...partial,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function markTimeout(err: unknown): boolean {
  return err instanceof Error && /timeout/i.test(err.message);
}

/** Выполнить после login (email / Google) или по кнопке Sync. */
export async function runPostLoginHooks(
  options?: RunPostLoginOptions,
): Promise<PostLoginResult> {
  const force = Boolean(options?.force);

  if (postLoginInFlight) return postLoginInFlight;

  // signIn + SIGNED_IN: reuse just-finished result. Button Sync uses force → fresh pass.
  if (
    !force &&
    lastCompleted &&
    Date.now() - lastCompleted.at < REUSE_RESULT_MS
  ) {
    return lastCompleted.result;
  }

  postLoginInFlight = executePostLoginHooks().finally(() => {
    postLoginInFlight = null;
  });

  const result = await postLoginInFlight;
  lastCompleted = { at: Date.now(), result };
  return result;
}

async function executePostLoginHooks(): Promise<PostLoginResult> {
  const session = await getAuthSession();
  const userId = session?.user?.id;
  if (!userId) {
    return emptyResult();
  }

  const storage = await getStorage();
  const localCount = storage.trackedProducts.length;
  const startedAt = Date.now();

  let claimed = 0;
  let merged = 0;
  let claimSkipped = false;
  let premiumRestored = false;
  let telegramRestored = false;
  let synced = false;
  let compareSynced = false;
  let timedOut = false;
  let error: string | undefined;

  const remainingMs = () =>
    Math.max(1_000, POST_LOGIN_TOTAL_TIMEOUT_MS - (Date.now() - startedAt));

  const claimKey = claimStorageKey(userId);
  const claimDone = (await chrome.storage.local.get(claimKey))[claimKey] === true;

  try {
    if (!claimDone) {
      try {
        const deviceId = await getDeviceId();
        const claimResult = await withTimeout(
          claimDeviceTrackedProducts(deviceId),
          Math.min(CLAIM_TIMEOUT_MS, remainingMs()),
          'claim',
        );
        if (claimResult) {
          claimed = claimResult.claimed;
          merged = claimResult.merged;
        }
        await chrome.storage.local.set({ [claimKey]: true });
      } catch (err) {
        console.warn('[PriceGuard Auth] claim failed', err);
        if (markTimeout(err)) timedOut = true;
        // Continue — tracked sync may still pull claimed rows later
      }
    } else {
      claimSkipped = true;
    }

    const budget = remainingMs();

    const [trackedOutcome, compareOutcome, premiumOutcome, alertOutcome] =
      await Promise.allSettled([
        withTimeout(syncTrackedProductsWithCloud(), budget, 'tracked-sync'),
        withTimeout(syncCompareProductsFromCloud(), budget, 'compare-sync'),
        withTimeout(restorePremiumFromAccount(), budget, 'premium-restore'),
        withTimeout(pullAlertSettingsFromCloud(), budget, 'alert-pull'),
      ]);

    if (trackedOutcome.status === 'fulfilled') {
      synced = trackedOutcome.value;
      await ensureTrackedRealtime();
    } else {
      console.warn('[PriceGuard Auth] tracked sync failed', trackedOutcome.reason);
      if (markTimeout(trackedOutcome.reason)) timedOut = true;
      else if (!error) {
        error =
          trackedOutcome.reason instanceof Error
            ? trackedOutcome.reason.message
            : String(trackedOutcome.reason);
      }
      // Still try realtime — session is valid
      void ensureTrackedRealtime();
    }

    if (compareOutcome.status === 'fulfilled') {
      compareSynced = Boolean(compareOutcome.value);
    } else {
      console.warn('[PriceGuard Auth] compare sync failed', compareOutcome.reason);
      if (markTimeout(compareOutcome.reason)) timedOut = true;
    }

    if (premiumOutcome.status === 'fulfilled') {
      premiumRestored = Boolean(premiumOutcome.value.restored);
    } else {
      console.warn('[PriceGuard Auth] restore premium failed', premiumOutcome.reason);
      if (markTimeout(premiumOutcome.reason)) timedOut = true;
    }

    if (alertOutcome.status === 'fulfilled') {
      telegramRestored = Boolean(alertOutcome.value?.restored);
    } else {
      console.warn('[PriceGuard Auth] pull alert settings failed', alertOutcome.reason);
      if (markTimeout(alertOutcome.reason)) timedOut = true;
    }

    // Push local alerts after pull (fire-and-forget)
    void syncAlertSettingsToCloud();

    // If everything timed out / failed and tracked never completed — surface error
    if (
      !error &&
      timedOut &&
      trackedOutcome.status === 'rejected' &&
      compareOutcome.status === 'rejected' &&
      premiumOutcome.status === 'rejected' &&
      alertOutcome.status === 'rejected'
    ) {
      error = 'post-login timeout';
    }
  } catch (err) {
    console.warn('[PriceGuard Auth] post-login failed', err);
    timedOut = markTimeout(err);
    error = err instanceof Error ? err.message : String(err);
  }

  const result: PostLoginResult = {
    claimed,
    merged,
    synced,
    compareSynced,
    localCount,
    claimSkipped,
    premiumRestored,
    telegramRestored,
    timedOut,
    error,
  };

  console.info('[PriceGuard Auth] post-login', {
    userId: userId.slice(0, 8),
    claimed,
    merged,
    localCount,
    synced,
    compareSynced,
    claimSkipped,
    premiumRestored,
    telegramRestored,
    timedOut,
    error,
    elapsedMs: Date.now() - startedAt,
  });

  return result;
}

/** Подписка Realtime на tracked_products текущего пользователя. */
export async function ensureTrackedRealtime(): Promise<void> {
  const user = await getAuthUser();
  if (!user?.id) {
    stopTrackedProductsRealtime();
    return;
  }

  startTrackedProductsRealtime(user.id, () => {
    void (async () => {
      if (!beginTrackedCloudSyncFromRealtime()) return;
      try {
        const ok = await syncTrackedProductsWithCloud();
        endTrackedCloudSyncFromRealtime(ok);
      } catch {
        endTrackedCloudSyncFromRealtime(false);
      }
    })();
  });
}

/** Остановить realtime (logout). */
export function teardownPostLogin(): void {
  stopTrackedProductsRealtime();
}
