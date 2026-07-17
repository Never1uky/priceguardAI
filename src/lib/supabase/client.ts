import { ApiError, formatApiErrorForUser, parseHttpApiError } from '@/api/errors';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { functionsUrl, getSupabaseConfig } from '@/lib/supabase/config';
import { getEdgeAuthHeaders } from '@/lib/supabase/edge-auth';

export interface ValidateLicenseResponse {
  ok: boolean;
  plan?: 'monthly' | 'yearly' | 'lifetime';
  expiresAt?: number;
  isDemo?: boolean;
  isLifetime?: boolean;
  error?: string;
}

export interface CreatePaymentResponse {
  ok: boolean;
  sessionId?: string;
  paymentUrl?: string;
  amountRub?: number;
  plan?: string;
  error?: string;
  code?: string;
}

export interface CheckPaymentResponse {
  ok: boolean;
  status?: 'pending' | 'succeeded' | 'canceled' | 'failed';
  licenseKey?: string;
  plan?: string;
  expiresAt?: number;
  error?: string;
}

export interface RestoreLicenseResponse {
  ok: boolean;
  restored?: boolean;
  licenseKey?: string;
  plan?: 'monthly' | 'yearly' | 'lifetime';
  expiresAt?: number;
  isLifetime?: boolean;
  reason?: string;
  error?: string;
}

async function parseResponseJson<T>(response: Response): Promise<T | null> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function callFunction<T extends { ok?: boolean; error?: string }>(
  name: string,
  body: unknown,
): Promise<T> {
  const { configured } = getSupabaseConfig();

  if (!configured) {
    throw new ApiError({
      code: 'not_configured',
      retryable: false,
      userMessage: 'Оплата не настроена. Настройте ЮKassa в Supabase.',
    });
  }

  let response: Response;

  try {
    const headers = await getEdgeAuthHeaders();
    response = await fetchWithRetry(
      functionsUrl(name),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      { retries: 1, delayMs: 600 },
    );
  } catch (error) {
    throw new ApiError({
      code: 'network',
      provider: 'Supabase',
      retryable: true,
      userMessage: 'Не удалось связаться с сервером лицензий. Проверьте интернет.',
      debugMessage: error instanceof Error ? error.message : String(error),
    });
  }

  const data = await parseResponseJson<T & { error?: string }>(response);

  if (!response.ok) {
    const apiMessage = data?.error;
    throw parseHttpApiError('Supabase', response.status, apiMessage ?? '');
  }

  if (!data) {
    throw new ApiError({
      code: 'empty_response',
      provider: 'Supabase',
      retryable: true,
      userMessage: 'Пустой ответ сервера. Повторите позже.',
    });
  }

  if (data.ok === false && data.error) {
    throw new ApiError({
      code: 'bad_request',
      provider: 'Supabase',
      retryable: false,
      userMessage: data.error,
    });
  }

  return data;
}

export async function validateLicenseRemote(
  key: string,
  deviceId: string,
): Promise<ValidateLicenseResponse> {
  try {
    return await callFunction<ValidateLicenseResponse>('validate-license', {
      key,
      deviceId,
      extensionVersion: chrome.runtime.getManifest().version,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.userMessage };
    }
    return { ok: false, error: formatApiErrorForUser(error) };
  }
}

export async function createPaymentRemote(
  plan: 'monthly' | 'yearly' | 'lifetime',
  customerEmail?: string,
): Promise<CreatePaymentResponse> {
  try {
    return await callFunction<CreatePaymentResponse>('create-payment', {
      plan,
      customerEmail,
      returnUrl: import.meta.env.VITE_PAYMENT_RETURN_URL as string | undefined,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.userMessage, code: error.code };
    }
    return { ok: false, error: formatApiErrorForUser(error) };
  }
}

export async function checkPaymentRemote(sessionId: string): Promise<CheckPaymentResponse> {
  try {
    return await callFunction<CheckPaymentResponse>('check-payment', { sessionId });
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.userMessage };
    }
    return { ok: false, error: formatApiErrorForUser(error) };
  }
}

export async function restoreLicenseRemote(): Promise<RestoreLicenseResponse> {
  try {
    return await callFunction<RestoreLicenseResponse>('restore-license', {});
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.userMessage };
    }
    return { ok: false, error: formatApiErrorForUser(error) };
  }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().configured;
}
