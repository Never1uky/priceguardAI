import {
  checkPaymentRemote,
  createPaymentRemote,
  isSupabaseConfigured,
} from '@/lib/supabase/client';
import { getAuthUser } from '@/lib/supabase/auth';
import { AI_AUTH_REQUIRED_MESSAGE, canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import type { PremiumPlanId } from '@/types/subscription';

const PENDING_SESSION_KEY = 'priceguard_pending_payment';

export interface PendingPayment {
  sessionId: string;
  plan: PremiumPlanId;
  createdAt: number;
}

export async function getPendingPayment(): Promise<PendingPayment | null> {
  const stored = await chrome.storage.local.get(PENDING_SESSION_KEY);
  return (stored[PENDING_SESSION_KEY] as PendingPayment) ?? null;
}

export async function clearPendingPayment(): Promise<void> {
  await chrome.storage.local.remove(PENDING_SESSION_KEY);
}

/** Создать платёж ЮKassa и открыть страницу оплаты */
export async function startCheckout(plan: PremiumPlanId): Promise<{
  ok: boolean;
  error?: string;
  sessionId?: string;
}> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: 'Оплата ещё не подключена. Используйте демо-ключ ниже.',
    };
  }

  if (!(await canUseCloudFeatures())) {
    return { ok: false, error: AI_AUTH_REQUIRED_MESSAGE };
  }

  try {
    const user = await getAuthUser();
    if (!user?.id) {
      return { ok: false, error: AI_AUTH_REQUIRED_MESSAGE };
    }
    const customerEmail = user.email?.trim() || undefined;

    const result = await createPaymentRemote(plan, customerEmail);

    if (!result.ok || !result.paymentUrl || !result.sessionId) {
      return {
        ok: false,
        error: result.error ?? 'Не удалось создать платёж',
      };
    }

    await chrome.storage.local.set({
      [PENDING_SESSION_KEY]: {
        sessionId: result.sessionId,
        plan,
        createdAt: Date.now(),
      } satisfies PendingPayment,
    });

    await chrome.tabs.create({ url: result.paymentUrl });

    return { ok: true, sessionId: result.sessionId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Ошибка оплаты',
    };
  }
}

/** Проверить статус оплаты и вернуть лицензионный ключ */
export async function checkPendingPayment(): Promise<{
  ok: boolean;
  licenseKey?: string;
  status?: string;
  error?: string;
}> {
  const pending = await getPendingPayment();
  if (!pending) {
    return { ok: false, error: 'Нет ожидающего платежа' };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase не настроен' };
  }

  try {
    const result = await checkPaymentRemote(pending.sessionId);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    if (result.status === 'succeeded' && result.licenseKey) {
      await clearPendingPayment();
      return { ok: true, licenseKey: result.licenseKey, status: result.status };
    }

    return {
      ok: true,
      status: result.status,
      error:
        result.status === 'pending'
          ? 'Оплата ещё не подтверждена — подождите и нажмите снова'
          : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Ошибка проверки',
    };
  }
}
