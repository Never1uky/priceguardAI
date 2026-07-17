/**
 * Заголовки для вызова Edge Functions.
 * Если пользователь авторизован — JWT; иначе anon key (публичные функции).
 */

import { getSupabaseConfig } from '@/lib/supabase/config';
import { getAccessToken } from '@/lib/supabase/auth';

export async function getEdgeAuthHeaders(): Promise<Record<string, string>> {
  const { anonKey } = getSupabaseConfig();
  const userToken = await getAccessToken();
  const bearer = userToken ?? anonKey;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearer}`,
    apikey: anonKey,
  };
}
