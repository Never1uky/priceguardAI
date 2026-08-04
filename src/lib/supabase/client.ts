import { ApiError, formatApiErrorForUser, parseHttpApiError } from '@/api/errors';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import { functionsUrl, getSupabaseConfig } from '@/lib/supabase/config';
import { getEdgeAuthHeaders } from '@/lib/supabase/edge-auth';

export interface ValidateLicenseResponse {
  ok: boolean;
  plan?: 'monthly' | 'yearly' | 'lifetime';
  expiresAt?: number;
  isDemo?: boolean;
  isLifetime?: boolean;
  accountBound?: boolean;
  error?: string;
  code?: string;
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

export interface ClaimTrialResponse {
  ok: boolean;
  expiresAt?: number;
  error?: string;
  code?: 'auth_required' | 'telegram_required' | 'trial_already_used' | string;
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
    const bodyCode =
      data && typeof data === 'object' && 'code' in data && typeof (data as { code?: unknown }).code === 'string'
        ? (data as { code: string }).code
        : undefined;
    if (bodyCode === 'auth_required' || response.status === 401) {
      throw new ApiError({
        code: 'unauthorized',
        provider: 'Supabase',
        retryable: false,
        status: response.status,
        userMessage: apiMessage || AI_AUTH_REQUIRED_MESSAGE,
        debugMessage: bodyCode,
      });
    }
    const parsed = parseHttpApiError('Supabase', response.status, apiMessage ?? '');
    throw new ApiError({
      code: parsed.code,
      provider: 'Supabase',
      retryable: parsed.retryable,
      status: response.status,
      userMessage: apiMessage || parsed.userMessage,
      debugMessage: bodyCode ?? parsed.debugMessage,
    });
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
    const bodyCode =
      'code' in data && typeof (data as { code?: unknown }).code === 'string'
        ? (data as { code: string }).code
        : undefined;
    throw new ApiError({
      code: bodyCode === 'auth_required' ? 'unauthorized' : 'bad_request',
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
      return {
        ok: false,
        error: error.userMessage,
        code: error.code === 'unauthorized' ? 'auth_required' : error.code,
      };
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

/** Серверный claim триала (chat_id + device_id). Платный Premium сюда не ходит. */
export async function claimTrialRemote(deviceId: string): Promise<ClaimTrialResponse> {
  try {
    const data = await callFunction<ClaimTrialResponse>('claim-trial', { deviceId });
    if (data.ok && typeof data.expiresAt === 'number') {
      return { ok: true, expiresAt: data.expiresAt };
    }
    return {
      ok: false,
      error: data.error ?? 'Не удалось активировать пробный период',
      code: data.code,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const msg = error.userMessage;
      const bodyCode = error.debugMessage;
      let code: ClaimTrialResponse['code'] =
        error.code === 'unauthorized' ? 'auth_required' : error.code;
      if (
        bodyCode === 'trial_already_used' ||
        error.status === 409 ||
        /уже использован/i.test(msg)
      ) {
        code = 'trial_already_used';
      } else if (
        bodyCode === 'telegram_required' ||
        (error.status === 400 && /Telegram|Chat ID/i.test(msg))
      ) {
        code = 'telegram_required';
      } else if (bodyCode === 'auth_required') {
        code = 'auth_required';
      }
      return { ok: false, error: msg, code };
    }
    return { ok: false, error: formatApiErrorForUser(error) };
  }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().configured;
}
