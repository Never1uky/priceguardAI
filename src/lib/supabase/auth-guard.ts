/**
 * Проверки авторизации для синхронизации, анализа и облачных функций.
 */

import { getAuthUser, getAccessToken, isAuthenticated } from '@/lib/supabase/auth';
import { getSupabaseConfig } from '@/lib/supabase/config';

export const AUTH_REQUIRED_MESSAGE =
  'Войдите во вкладку «Аккаунт» для синхронизации и облачных функций';

export const AI_AUTH_REQUIRED_MESSAGE =
  'Войдите, чтобы разобрать отзывы.';

/** Supabase настроен и есть активная сессия */
export async function canUseCloudFeatures(): Promise<boolean> {
  if (!getSupabaseConfig().configured) return false;
  return isAuthenticated();
}

/** JWT или null (без throw) */
export async function getAuthTokenOrNull(): Promise<string | null> {
  if (!getSupabaseConfig().configured) return null;
  return getAccessToken();
}

/** user.id или null */
export async function getAuthUserIdOrNull(): Promise<string | null> {
  const user = await getAuthUser();
  return user?.id ?? null;
}

/**
 * Выполнить fn только для авторизованного пользователя.
 * Иначе вернуть fallback (по умолчанию null).
 */
export async function withAuthenticatedUser<T>(
  fn: (userId: string) => Promise<T>,
  fallback: T | null = null,
): Promise<T | null> {
  const userId = await getAuthUserIdOrNull();
  if (!userId) return fallback;
  return fn(userId);
}
