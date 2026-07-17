/**
 * Отправка ошибок расширения в Telegram-поддержку (Edge: support-notify).
 * Rate-limit: не чаще 1 раза в 60 сек на одинаковый текст.
 * Expected UX/auth ошибки не шлём (шум вроде Invalid login credentials).
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { getAuthUserIdOrNull } from '@/lib/supabase/auth-guard';

const LAST_KEY = 'priceguard_last_support_error';
const COOLDOWN_MS = 60_000;

interface LastPayload {
  message: string;
  at: number;
}

/** Ожидаемые UX/auth сообщения — не репортить в поддержку */
export function shouldReportExtensionError(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) return false;

  const skipPatterns = [
    /invalid login/,
    /invalid.?login.?credentials/,
    /email not confirmed/,
    /user already registered/,
    /signup.?requires.?a.?valid.?password/,
    /password should be at least/,
    /неверн(ый|ая).*(пароль|email|почт|логин)/,
    /ошибка авторизации/,
    /войдите в аккаунт/,
    /требуется вход/,
    /нужно войти/,
    /лимит бесплатной/,
    /оформите premium/,
    /недостаточно отзывов/,
    /нет данных товара/,
    /дождитесь загрузки/,
    /анализ уже выполняется/,
    /ai временно недоступен/,
    /supabase не настроен/,
    /networkerror|failed to fetch/,
    /ошибка связи с расширением/,
  ];

  return !skipPatterns.some((re) => re.test(m));
}

export async function reportExtensionError(
  message: string,
  context?: string,
): Promise<void> {
  if (!getSupabaseConfig().configured) return;
  const trimmed = message.trim().slice(0, 800);
  if (!trimmed) return;
  if (!shouldReportExtensionError(trimmed)) return;

  try {
    const stored = await chrome.storage.session.get(LAST_KEY);
    const last = stored[LAST_KEY] as LastPayload | undefined;
    if (
      last &&
      last.message === trimmed &&
      Date.now() - last.at < COOLDOWN_MS
    ) {
      return;
    }

    await chrome.storage.session.set({
      [LAST_KEY]: { message: trimmed, at: Date.now() } satisfies LastPayload,
    });

    const userId = await getAuthUserIdOrNull();
    const version = chrome.runtime.getManifest().version;

    void callEdgeSafe('support-notify', {
      message: trimmed,
      context: context?.slice(0, 200),
      version,
      userId: userId ?? undefined,
    });
  } catch {
    // не ломаем UX при сбое репорта
  }
}
