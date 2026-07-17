/**
 * Freemium: лимит AI-запросов для бесплатных пользователей.
 * Счётчик в chrome.storage.local, сброс каждые 24 часа.
 */

import { isPremium } from '@/lib/subscription';
import { hasAnyApiKey } from '@/api/ai';

export const FREE_DAILY_AI_LIMIT = 3;
const STORAGE_KEY = 'priceguard_ai_daily_quota';
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface DailyQuota {
  /** Начало текущего 24-часового окна */
  windowStart: number;
  requestCount: number;
}

async function readQuota(): Promise<DailyQuota> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const quota = stored[STORAGE_KEY] as DailyQuota | undefined;
  const now = Date.now();

  if (!quota || now - quota.windowStart >= WINDOW_MS) {
    return { windowStart: now, requestCount: 0 };
  }

  return quota;
}

async function writeQuota(quota: DailyQuota): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: quota });
}

export interface AiQuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsInMs: number;
  reason?: string;
  needsApiKey?: boolean;
}

/** Проверить, можно ли сделать облачный AI-запрос */
export async function canMakeAiRequest(): Promise<AiQuotaCheck> {
  const premium = await isPremium();
  const hasKey = await hasAnyApiKey();

  if (!hasKey) {
    return {
      allowed: false,
      used: 0,
      limit: FREE_DAILY_AI_LIMIT,
      remaining: 0,
      resetsInMs: 0,
      needsApiKey: true,
      reason: 'AI-сервер недоступен. Обновите расширение или проверьте интернет.',
    };
  }

  if (premium) {
    return {
      allowed: true,
      used: 0,
      limit: Infinity,
      remaining: Infinity,
      resetsInMs: 0,
    };
  }

  const quota = await readQuota();
  const remaining = Math.max(0, FREE_DAILY_AI_LIMIT - quota.requestCount);
  const resetsInMs = Math.max(0, WINDOW_MS - (Date.now() - quota.windowStart));

  if (quota.requestCount >= FREE_DAILY_AI_LIMIT) {
    const hours = Math.ceil(resetsInMs / (60 * 60 * 1000));
    return {
      allowed: false,
      used: quota.requestCount,
      limit: FREE_DAILY_AI_LIMIT,
      remaining: 0,
      resetsInMs,
      reason: `Лимит ${FREE_DAILY_AI_LIMIT} AI-запросов в сутки исчерпан. Сброс через ~${hours} ч. Оформите Premium для безлимита.`,
    };
  }

  return {
    allowed: true,
    used: quota.requestCount,
    limit: FREE_DAILY_AI_LIMIT,
    remaining,
    resetsInMs,
  };
}

/** Учесть успешный облачный AI-запрос (не вызывать для кэша / локального анализа) */
export async function recordAiRequest(): Promise<void> {
  if (await isPremium()) return;

  const quota = await readQuota();
  quota.requestCount += 1;
  await writeQuota(quota);
}

export async function getAiQuotaStats(): Promise<{
  used: number;
  limit: number;
  remaining: number;
  isPremium: boolean;
  hasApiKey: boolean;
  resetsInMs: number;
}> {
  const [check, premium, hasKey] = await Promise.all([
    canMakeAiRequest(),
    isPremium(),
    hasAnyApiKey(),
  ]);

  return {
    used: check.used,
    limit: premium ? Infinity : FREE_DAILY_AI_LIMIT,
    remaining: check.remaining,
    isPremium: premium,
    hasApiKey: hasKey,
    resetsInMs: check.resetsInMs,
  };
}
