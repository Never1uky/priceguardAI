/**
 * Supabase Auth для Chrome-расширения (только email / пароль).
 */

import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { runPostLoginHooks, teardownPostLogin } from '@/lib/supabase/post-login';
import { isContextInvalidatedError, isExtensionContextValid } from '@/lib/extension-context';

const AUTH_STORAGE_KEY = 'priceguard_supabase_auth';

/** Content scripts die on extension reload — never run auto-refresh timers there. */
function isContentScriptWorld(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof location !== 'undefined' &&
      location.protocol !== 'chrome-extension:'
    );
  } catch {
    return false;
  }
}

/** Домены, куда письма Supabase без своего SMTP часто не доходят (РФ). */
const UNRELIABLE_AUTH_EMAIL_DOMAINS = new Set([
  'yandex.ru',
  'yandex.com',
  'ya.ru',
  'mail.ru',
  'inbox.ru',
  'bk.ru',
  'list.ru',
  'internet.ru',
]);

/** Яндекс / Mail.ru и aliases — сброс/confirm через дефолтный SMTP ненадёжен. */
export function isUnreliableAuthEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  if (UNRELIABLE_AUTH_EMAIL_DOMAINS.has(domain)) return true;
  // поддомены вроде xxx.yandex.ru
  return [...UNRELIABLE_AUTH_EMAIL_DOMAINS].some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}

const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (!isExtensionContextValid()) return null;
      const stored = await chrome.storage.local.get(key);
      return (stored[key] as string | undefined) ?? null;
    } catch (error) {
      if (isContextInvalidatedError(error)) return null;
      throw error;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (!isExtensionContextValid()) return;
      await chrome.storage.local.set({ [key]: value });
    } catch (error) {
      if (isContextInvalidatedError(error)) return;
      throw error;
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (!isExtensionContextValid()) return;
      await chrome.storage.local.remove(key);
    } catch (error) {
      if (isContextInvalidatedError(error)) return;
      throw error;
    }
  },
};

let client: SupabaseClient | null = null;

export function getSupabaseAuthClient(): SupabaseClient | null {
  const { url, anonKey, configured } = getSupabaseConfig();
  if (!configured) return null;

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        storage: chromeStorageAdapter,
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: !isContentScriptWorld(),
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

export async function getAuthSession(): Promise<Session | null> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getAuthSession();
  return session?.access_token ?? null;
}

export async function getAuthUser(): Promise<User | null> {
  const session = await getAuthSession();
  return session?.user ?? null;
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await getAccessToken());
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseAuthClient();
  if (!supabase) throw new Error('Supabase не настроен');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  if (data.session) await runPostLoginHooks();
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const supabase = getSupabaseAuthClient();
  if (!supabase) throw new Error('Supabase не настроен');
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  if (data.session) await runPostLoginHooks();
  return data;
}

/** Повторная отправка письма подтверждения (fallback, если confirm ещё включён на сервере). */
export async function resendSignupConfirmation(email: string): Promise<void> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) throw new Error('Supabase не настроен');
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
  });
  if (error) throw error;
}

export async function resetPasswordForEmail(email: string): Promise<void> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) throw new Error('Supabase не настроен');
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseAuthClient();
  teardownPostLogin();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function onAuthStateChange(
  callback: (session: Session | null, event: string) => void,
): (() => void) | null {
  const supabase = getSupabaseAuthClient();
  if (!supabase) return null;
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
  return () => subscription.unsubscribe();
}
