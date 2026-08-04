/**
 * Тонкий клиент для вызова Supabase Edge Functions из расширения.
 *
 * - callEdge:      бросает ошибку при сбое (для AI-прокси, где важен результат).
 * - callEdgeSafe:  никогда не бросает, возвращает null (для кэша/метрик/синка —
 *                  их сбой не должен ломать основной сценарий).
 *
 * Edge = accelerator: 5xx/timeout soft-fail silently (debug only), never user-facing "HTTP 502".
 */

import { safeFetch, type NetworkFailure } from '@/lib/fetch-retry';
import { functionsUrl, getSupabaseConfig } from '@/lib/supabase/config';
import { getEdgeAuthHeaders } from '@/lib/supabase/edge-auth';
import { noteCloudNetworkFailure } from '@/lib/supabase/cloud-reachability';
import { telemetry } from '@/lib/telemetry/log';

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
    readonly failureKind?: NetworkFailure['kind'],
  ) {
    super(message);
    this.name = 'EdgeError';
  }
}

const EDGE_TIMEOUT_MS = 10_000;

/** Rate-limited debug log — never surface HTTP 502 to users. */
let lastEdgeDebugAt = 0;
const EDGE_DEBUG_COOLDOWN_MS = 20_000;

function debugEdgeFailure(name: string, detail: string): void {
  const now = Date.now();
  if (now - lastEdgeDebugAt < EDGE_DEBUG_COOLDOWN_MS) return;
  lastEdgeDebugAt = now;
  console.debug(`[PriceGuard] Edge ${name} degraded: ${detail}`);
}

async function parseEdgeBody<T extends EdgeResult>(response: Response): Promise<T | null> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function callEdge<T extends EdgeResult>(
  name: string,
  body: unknown,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { configured } = getSupabaseConfig();
  if (!configured) {
    throw new EdgeError('Supabase не настроен');
  }

  const headers = await getEdgeAuthHeaders();
  const result = await safeFetch(
    functionsUrl(name),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    {
      retries: options.retries ?? 2,
      delayMs: 600,
      timeoutMs: options.timeoutMs ?? EDGE_TIMEOUT_MS,
      backoff: 'exponential',
      jitter: true,
    },
  );

  if (!result.ok) {
    const status = result.error.status ?? result.response?.status;
    throw new EdgeError(
      result.error.userMessage,
      status,
      undefined,
      result.error.kind,
    );
  }

  const data = await parseEdgeBody<T>(result.response);
  if (!data) {
    throw new EdgeError('Пустой ответ Edge Function', result.response.status);
  }
  if (data.ok === false && data.error) {
    throw new EdgeError(data.error, result.response.status, data.code);
  }
  return data;
}

export async function callEdgeSafe<T extends EdgeResult>(
  name: string,
  body: unknown,
): Promise<T | null> {
  if (!getSupabaseConfig().configured) return null;
  const started = Date.now();
  try {
    const data = await callEdge<T>(name, body, { retries: 2, timeoutMs: EDGE_TIMEOUT_MS });
    telemetry.info({
      stage: 'edge',
      name: 'EDGE_REQUEST',
      success: true,
      elapsedMs: Date.now() - started,
      data: { function: name },
    });
    return data;
  } catch (error) {
    const kind =
      error instanceof EdgeError ? error.failureKind : undefined;
    const status = error instanceof EdgeError ? error.status : undefined;
    const isTransient =
      kind === 'timeout' ||
      kind === 'network' ||
      kind === 'offline' ||
      kind === 'http5xx' ||
      (error instanceof EdgeError &&
        error.status != null &&
        (error.status === 429 || error.status >= 500));

    const cloudSensitive =
      name === 'tracked-sync' ||
      name === 'sync-alert-settings' ||
      name === 'telegram-price-alert';

    telemetry.warn({
      stage: 'edge',
      name: 'EDGE_REQUEST',
      success: false,
      elapsedMs: Date.now() - started,
      errorCode: kind ?? (status != null ? `http_${status}` : 'edge_error'),
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error),
      data: { function: name, status, transient: isTransient },
    });

    if (cloudSensitive && (kind === 'offline' || kind === 'network')) {
      noteCloudNetworkFailure(name, error);
    } else if (isTransient) {
      debugEdgeFailure(
        name,
        kind ?? (error instanceof Error ? error.message : String(error)),
      );
    } else {
      debugEdgeFailure(
        name,
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
}
