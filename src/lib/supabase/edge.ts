/**
 * Тонкий клиент для вызова Supabase Edge Functions из расширения.
 *
 * - callEdge:      бросает ошибку при сбое (для AI-прокси, где важен результат).
 * - callEdgeSafe:  никогда не бросает, возвращает null (для кэша/метрик/синка —
 *                  их сбой не должен ломать основной сценарий).
 */

import { fetchWithRetry } from '@/lib/fetch-retry';
import { functionsUrl, getSupabaseConfig } from '@/lib/supabase/config';
import { getEdgeAuthHeaders } from '@/lib/supabase/edge-auth';

export interface EdgeResult {
  ok?: boolean;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export class EdgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'EdgeError';
  }
}

export async function callEdge<T extends EdgeResult>(
  name: string,
  body: unknown,
  options: { retries?: number } = {},
): Promise<T> {
  const { configured } = getSupabaseConfig();
  if (!configured) {
    throw new EdgeError('Supabase не настроен');
  }

  const headers = await getEdgeAuthHeaders();

  const response = await fetchWithRetry(
    functionsUrl(name),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    { retries: options.retries ?? 1, delayMs: 600 },
  );

  const text = await response.text().catch(() => '');
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new EdgeError(data?.error ?? `HTTP ${response.status}`, response.status, data?.code);
  }
  if (!data) {
    throw new EdgeError('Пустой ответ Edge Function');
  }
  if (data.ok === false && data.error) {
    throw new EdgeError(data.error, response.status, data.code);
  }
  return data;
}

export async function callEdgeSafe<T extends EdgeResult>(
  name: string,
  body: unknown,
): Promise<T | null> {
  if (!getSupabaseConfig().configured) return null;
  try {
    return await callEdge<T>(name, body, { retries: 0 });
  } catch (error) {
    console.warn(`[PriceGuard] Edge ${name} failed:`, error);
    return null;
  }
}
