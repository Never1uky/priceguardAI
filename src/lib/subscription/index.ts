import {
  FREE_LIMITS,
  type SubscriptionState,
  type SubscriptionTier,
} from '@/types/subscription';
import { agentLog } from '@/lib/debug-log';
import { getDeviceId } from '@/lib/subscription/device-id';
import {
  isSupabaseConfigured,
  restoreLicenseRemote,
  validateLicenseRemote,
  claimTrialRemote,
} from '@/lib/supabase/client';
import { canUseCloudFeatures, AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import {
  clearPremiumClaimOnServer,
  setServerPriceMonitoringActive,
  syncAlertSettingsToCloud,
} from '@/lib/supabase/alert-settings-sync';
import { getPriceAlertSettings } from '@/lib/compare-price-alerts';
import {
  findMyProductByUrl,
  getMyProductSlotCount,
  getMyProductsLimit,
  loadMyProductItems,
} from '@/lib/my-products';

const STORAGE_KEY = 'priceguard_subscription';
const TRIAL_USED_KEY = 'priceguard_trial_used';
const AI_USAGE_KEY = 'priceguard_ai_usage';

const VALID_LICENSE_PREFIXES = ['PGAI-', 'PRICEGUARD-'];

type RemotePlan = 'monthly' | 'yearly' | 'lifetime';

interface AiUsageDay {
  date: string;
  count: number;
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase().replace(/\s+/g, '');
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readSubscription(): Promise<SubscriptionState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const sub = stored[STORAGE_KEY] as SubscriptionState | undefined;
  return sub ?? { tier: 'free' };
}

async function writeSubscription(state: SubscriptionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function isPremiumActive(sub: SubscriptionState): boolean {
  if (sub.tier !== 'premium') return false;
  if (!sub.expiresAt) return true;
  return Date.now() < sub.expiresAt;
}

/** @internal Unit tests */
export function isPremiumSubscriptionActive(sub: SubscriptionState): boolean {
  return isPremiumActive(sub);
}

function notifyPaidPremiumExpired(): void {
  void (async () => {
    await clearPremiumClaimOnServer();
    await syncAlertSettingsToCloud();
  })();
}

function applyPremiumState(
  key: string | undefined,
  plan: RemotePlan,
  expiresAt: number | undefined,
  source: SubscriptionState['source'],
): SubscriptionState {
  return {
    tier: 'premium',
    activatedAt: Date.now(),
    licenseKey: key,
    source,
    expiresAt: plan === 'lifetime' ? undefined : expiresAt,
  };
}

export async function getSubscription(): Promise<SubscriptionState> {
  const sub = await readSubscription();
  if (sub.tier === 'premium' && !isPremiumActive(sub)) {
    const wasTrial = sub.source === 'trial';
    const downgraded: SubscriptionState = { tier: 'free' };
    await writeSubscription(downgraded);
    if (!wasTrial) {
      notifyPaidPremiumExpired();
    }
    return downgraded;
  }
  return sub;
}

export async function isPremium(): Promise<boolean> {
  const sub = await getSubscription();
  return isPremiumActive(sub);
}

export async function getTier(): Promise<SubscriptionTier> {
  return (await isPremium()) ? 'premium' : 'free';
}

/** Активен ли именно пробный период (не оплаченный Premium) */
export async function isTrialActive(): Promise<boolean> {
  const sub = await getSubscription();
  return isPremiumActive(sub) && sub.source === 'trial';
}

export async function hasUsedTrial(): Promise<boolean> {
  const stored = await chrome.storage.local.get(TRIAL_USED_KEY);
  return Boolean(stored[TRIAL_USED_KEY]);
}

/** Локальный UX-гейт: Chat ID в настройках (сервер всё равно проверяет облако). */
export async function hasLocalTelegramForTrial(): Promise<boolean> {
  const settings = await getPriceAlertSettings();
  return settings.telegramChatId.trim().length > 0;
}

/**
 * Можно ли показать CTA триала (вход + не Premium + локально ещё не брал).
 * Без Telegram кнопка может быть disabled — см. hasLocalTelegramForTrial.
 */
export async function canStartTrial(): Promise<boolean> {
  if (!(await canUseCloudFeatures())) return false;
  if (!isSupabaseConfigured()) return false;
  if (await isPremium()) return false;
  return !(await hasUsedTrial());
}

/**
 * Старт бесплатного Premium на TRIAL_DAYS.
 * Источник правды — Edge claim-trial (chat_id + device_id). Локальный флаг — UX-кэш.
 * Отвязка Telegram после старта не отзывает активный триал до expiresAt.
 */
export async function startTrial(): Promise<{ ok: boolean; error?: string; expiresAt?: number }> {
  if (!(await canUseCloudFeatures())) {
    return { ok: false, error: AI_AUTH_REQUIRED_MESSAGE };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Сервер не настроен. Попробуйте позже.' };
  }
  if (await isPremium()) {
    return { ok: false, error: 'Premium уже активен' };
  }
  if (await hasUsedTrial()) {
    return { ok: false, error: 'Пробный период уже использован. Оформите подписку.' };
  }

  if (!(await hasLocalTelegramForTrial())) {
    return {
      ok: false,
      error: 'Подключите Telegram в Настройках, затем повторите.',
    };
  }

  const deviceId = await getDeviceId();
  const remote = await claimTrialRemote(deviceId);

  if (!remote.ok || typeof remote.expiresAt !== 'number') {
    if (remote.code === 'trial_already_used') {
      await chrome.storage.local.set({ [TRIAL_USED_KEY]: true });
    }
    if (remote.code === 'telegram_required') {
      return {
        ok: false,
        error: 'Подключите Telegram в Настройках (Chat ID), затем повторите.',
      };
    }
    if (remote.code === 'trial_already_used') {
      return {
        ok: false,
        error: 'Пробный период уже использован на этом устройстве или Telegram.',
      };
    }
    if (remote.code === 'auth_required') {
      return { ok: false, error: AI_AUTH_REQUIRED_MESSAGE };
    }
    return {
      ok: false,
      error: remote.error ?? 'Не удалось активировать пробный период',
    };
  }

  await writeSubscription({
    tier: 'premium',
    activatedAt: Date.now(),
    expiresAt: remote.expiresAt,
    source: 'trial',
  });
  await chrome.storage.local.set({ [TRIAL_USED_KEY]: true });

  return { ok: true, expiresAt: remote.expiresAt };
}

/** Активация Premium — через Supabase validate-license (ключ после оплаты ЮKassa). Требует вход в аккаунт. */
export async function activateLicenseKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeKey(key);

  agentLog(
    'subscription/index.ts:activateLicenseKey',
    'license activation attempt',
    {
      keyPrefix: normalized.slice(0, 12),
      supabaseConfigured: isSupabaseConfigured(),
    },
    'C',
  );

  if (!(await canUseCloudFeatures())) {
    return { ok: false, error: AI_AUTH_REQUIRED_MESSAGE };
  }

  if (!VALID_LICENSE_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { ok: false, error: 'Неверный формат ключа. Ожидается PGAI-XXXX-XXXX' };
  }

  if (normalized.length < 12) {
    return { ok: false, error: 'Ключ слишком короткий' };
  }

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Сервер лицензий не настроен. Оформите Premium через оплату.',
    };
  }

  const deviceId = await getDeviceId();

  try {
    const remote = await validateLicenseRemote(normalized, deviceId);
    if (remote.ok && remote.plan) {
      const plan = remote.plan as RemotePlan;
      const state = applyPremiumState(normalized, plan, remote.expiresAt, 'supabase');
      await writeSubscription(state);
      void syncAlertSettingsToCloud();
      return { ok: true };
    }
    return { ok: false, error: remote.error ?? 'Ключ недействителен или лимит устройств исчерпан' };
  } catch (error) {
    console.warn('[PriceGuard] Supabase validate failed:', error);
    return { ok: false, error: 'Не удалось проверить ключ. Проверьте интернет.' };
  }
}

export async function syncSubscriptionWithServer(): Promise<void> {
  const sub = await readSubscription();
  if (sub.tier !== 'premium' || !sub.licenseKey || !isSupabaseConfigured()) return;
  if (sub.source === 'trial') return;
  // Без сессии validate-license недоступен — не сбрасываем локальный Premium
  if (!(await canUseCloudFeatures())) return;

  try {
    const deviceId = await getDeviceId();
    const remote = await validateLicenseRemote(sub.licenseKey, deviceId);

    if (!remote.ok) {
      if (remote.code === 'auth_required') return;
      await writeSubscription({ tier: 'free' });
      void clearPremiumClaimOnServer();
    } else if (remote.plan) {
      await writeSubscription(
        applyPremiumState(sub.licenseKey, remote.plan as RemotePlan, remote.expiresAt, 'supabase'),
      );
    }
  } catch {
    // Офлайн — оставляем локальный статус
  }
}

/**
 * После входа: восстановить Premium из user_premium (переустановка / новый браузер).
 * Не трогает активный trial и уже активный Premium с тем же ключом.
 */
export async function restorePremiumFromAccount(): Promise<{
  ok: boolean;
  restored: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { ok: false, restored: false, error: 'Сервер не настроен' };
  }
  if (!(await canUseCloudFeatures())) {
    return { ok: false, restored: false, error: AI_AUTH_REQUIRED_MESSAGE };
  }

  const current = await getSubscription();
  if (isPremiumActive(current) && current.source === 'trial') {
    return { ok: true, restored: false };
  }

  try {
    const remote = await restoreLicenseRemote();
    if (!remote.ok) {
      return { ok: false, restored: false, error: remote.error };
    }
    if (!remote.restored || !remote.licenseKey || !remote.plan) {
      return { ok: true, restored: false };
    }

    if (
      isPremiumActive(current) &&
      current.licenseKey &&
      normalizeKey(current.licenseKey) === normalizeKey(remote.licenseKey)
    ) {
      return { ok: true, restored: false };
    }

    // Активируем на этом устройстве (лимит устройств / привязка JWT)
    const activated = await activateLicenseKey(remote.licenseKey);
    if (!activated.ok) {
      // Ключ есть на аккаунте — всё равно восстановим локальный Premium state
      const state = applyPremiumState(
        remote.licenseKey,
        remote.plan as RemotePlan,
        remote.expiresAt,
        'supabase',
      );
      await writeSubscription(state);
      return { ok: true, restored: true, error: activated.error };
    }

    return { ok: true, restored: true };
  } catch (error) {
    return {
      ok: false,
      restored: false,
      error: error instanceof Error ? error.message : 'Ошибка восстановления',
    };
  }
}

export async function deactivatePremium(): Promise<void> {
  await writeSubscription({ tier: 'free' });
  await clearPremiumClaimOnServer();
  await setServerPriceMonitoringActive(false);
  await syncAlertSettingsToCloud();
}

// ——— AI usage (Free) ———

async function readAiUsage(): Promise<AiUsageDay> {
  const stored = await chrome.storage.local.get(AI_USAGE_KEY);
  const usage = stored[AI_USAGE_KEY] as AiUsageDay | undefined;
  const today = todayKey();
  if (!usage || usage.date !== today) {
    return { date: today, count: 0 };
  }
  return usage;
}

async function writeAiUsage(usage: AiUsageDay): Promise<void> {
  await chrome.storage.local.set({ [AI_USAGE_KEY]: usage });
}

export interface AiQuotaStatus {
  unlimited: boolean;
  used: number;
  limit: number;
  remaining: number;
  label: string;
}

export async function getAiQuotaStatus(): Promise<AiQuotaStatus> {
  if (await isPremium()) {
    return {
      unlimited: true,
      used: 0,
      limit: Infinity,
      remaining: Infinity,
      label: 'Неограниченно',
    };
  }

  const usage = await readAiUsage();
  const limit = FREE_LIMITS.maxAiRequestsPerDay;
  const remaining = Math.max(0, limit - usage.count);

  return {
    unlimited: false,
    used: usage.count,
    limit,
    remaining,
    label: `Осталось ${remaining} из ${limit} сегодня`,
  };
}

export async function canRunReviewAnalysis(): Promise<{ allowed: boolean; reason?: string }> {
  if (!(await canUseCloudFeatures())) {
    return { allowed: false, reason: AI_AUTH_REQUIRED_MESSAGE };
  }
  if (await isPremium()) return { allowed: true };
  const quota = await getAiQuotaStatus();
  if (quota.remaining > 0) return { allowed: true };
  return {
    allowed: false,
    reason: `Лимит Free: ${FREE_LIMITS.maxAiRequestsPerDay} AI-анализов в сутки. Оформите Premium или подождите завтра.`,
  };
}

export async function recordReviewAnalysis(): Promise<void> {
  if (await isPremium()) return;
  const usage = await readAiUsage();
  await writeAiUsage({ date: todayKey(), count: usage.count + 1 });
}

export async function canRunFullAnalysis(): Promise<{ allowed: boolean; reason?: string }> {
  if (!(await canUseCloudFeatures())) {
    return { allowed: false, reason: AI_AUTH_REQUIRED_MESSAGE };
  }
  if (await isPremium()) return { allowed: true };
  if (!FREE_LIMITS.fullAnalysisEnabled) {
    return { allowed: false, reason: 'Полный AI-анализ доступен в Premium' };
  }
  return canRunReviewAnalysis();
}

export async function recordFullAnalysis(): Promise<void> {
  // Free: 1 попытка за успешный user_run / hard_refresh (в т.ч. cache hit как ответ на Run).
  // Soft refresh и тихий hydrate кэша — не вызывают эту функцию (см. full-analysis-quota-policy).
  await recordReviewAnalysis();
}

export async function getUsageStats(): Promise<{
  reviewAnalyses: number;
  fullAnalyses: number;
  reviewLimit: number;
  tier: SubscriptionTier;
  remaining: number;
  unlimited: boolean;
}> {
  const tier = await getTier();
  const quota = await getAiQuotaStatus();
  return {
    reviewAnalyses: quota.used,
    fullAnalyses: quota.used,
    reviewLimit: quota.unlimited ? Infinity : quota.limit,
    remaining: quota.remaining,
    unlimited: quota.unlimited,
    tier,
  };
}

export async function canTrackMoreProducts(
  currentCount?: number,
): Promise<{ allowed: boolean; limit: number }> {
  const premium = await isPremium();
  const limit = getMyProductsLimit(premium);
  const slotCount = await getMyProductSlotCount();
  const count = currentCount != null ? Math.max(currentCount, slotCount) : slotCount;
  return {
    allowed: count < limit,
    limit,
  };
}

export async function canAddCompareProduct(
  currentCount?: number,
): Promise<{ allowed: boolean; limit: number }> {
  const premium = await isPremium();
  const limit = getMyProductsLimit(premium);
  const slotCount = await getMyProductSlotCount();
  const count = currentCount != null ? Math.max(currentCount, slotCount) : slotCount;
  return {
    allowed: count < limit,
    limit,
  };
}

/** Unified Free/Premium gate for «Мои товары». Skip limit if URL already in the list. */
export async function canAddMyProduct(options?: {
  url?: string;
}): Promise<{ allowed: boolean; limit: number; count: number; alreadyPresent: boolean }> {
  const premium = await isPremium();
  const limit = getMyProductsLimit(premium);
  const count = await getMyProductSlotCount();

  if (options?.url) {
    const items = await loadMyProductItems();
    const existing = findMyProductByUrl(items, options.url);
    if (existing) {
      return { allowed: true, limit, count, alreadyPresent: true };
    }
  }

  return {
    allowed: count < limit,
    limit,
    count,
    alreadyPresent: false,
  };
}
