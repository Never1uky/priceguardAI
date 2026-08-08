// Проверка JWT пользователя Supabase Auth в Edge Functions.
// Возвращает user_id из токена или null, если токен невалиден / отсутствует.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export interface AuthUser {
  id: string;
  email?: string;
}

/** Извлечь Bearer-токен из заголовка Authorization. */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Проверить JWT и вернуть пользователя.
 * @param req входящий запрос Edge Function
 * @param required если true — бросает Error при отсутствии авторизации
 */
export async function requireAuthUser(req: Request, required = true): Promise<AuthUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    if (required) throw new Error('auth_required');
    return null;
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    if (required) throw new Error('invalid_token');
    return null;
  }

  return { id: user.id, email: user.email };
}

/** Проверить доступ к дашборду метрик. Пустой METRICS_ADMIN_EMAILS → deny-all. */
export { canAccessMetrics } from './metrics-access.ts';

/** @deprecated используйте canAccessMetrics */
export { canAccessMetrics as isMetricsAdmin } from './metrics-access.ts';
