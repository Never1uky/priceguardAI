/**
 * Отправка price-alert в Telegram через Supabase Edge Function.
 * Chat ID задаётся пользователем в настройках расширения.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { makeReferralLinkAsync } from '@/utils/referral';
import { telemetry } from '@/lib/telemetry/log';
import { trackTelegramAlertSent } from '@/lib/telemetry/ops';
import type { Marketplace } from '@/types/product';

export interface TelegramPriceAlertPayload {
  chatId: string;
  message?: string;
  url?: string;
  marketplace?: Marketplace;
  /** Структурированный алерт — Edge сам соберёт красивый текст + кнопку */
  type?: 'price_drop' | 'compare_price_drop' | 'target_price' | 'generic' | 'cheaper_elsewhere';
  title?: string;
  oldPrice?: number;
  newPrice?: number;
  targetPrice?: number;
  buttonText?: string;
  /** Для cheaper_elsewhere: площадка-источник */
  sourceMarketplace?: Marketplace;
  sourcePrice?: number;
}

export async function sendTelegramPriceAlert(
  payload: TelegramPriceAlertPayload,
): Promise<{ sent: boolean; error?: string }> {
  if (!getSupabaseConfig().configured) {
    return { sent: false, error: 'Supabase не настроен' };
  }

  const url = payload.url
    ? await makeReferralLinkAsync(payload.url, payload.marketplace)
    : undefined;

  const res = await callEdgeSafe<{ ok: boolean; sent?: boolean; error?: string }>(
    'price-alert-notify',
    {
      chatId: payload.chatId,
      message: payload.message,
      url,
      type: payload.type ?? (payload.message ? 'generic' : undefined),
      title: payload.title,
      oldPrice: payload.oldPrice,
      newPrice: payload.newPrice,
      targetPrice: payload.targetPrice,
      marketplace: payload.marketplace,
      buttonText: payload.buttonText ?? '🛒 Открыть товар',
      sourceMarketplace: payload.sourceMarketplace,
      sourcePrice: payload.sourcePrice,
    },
  );

  if (!res?.ok) {
    telemetry.warn({
      stage: 'telegram',
      name: 'TELEGRAM_SEND',
      success: false,
      marketplace: payload.marketplace,
      errorCode: 'telegram_send_failed',
      errorMessage: res?.error,
      data: { type: payload.type ?? 'generic' },
    });
    return { sent: false, error: res?.error ?? 'Не удалось отправить в Telegram' };
  }

  const sent = Boolean(res.sent);
  telemetry.event('TELEGRAM_SEND', {
    level: sent ? 'info' : 'warn',
    stage: 'telegram',
    success: sent,
    marketplace: payload.marketplace,
    data: { type: payload.type ?? 'generic' },
  });
  if (sent && payload.type) {
    trackTelegramAlertSent({
      marketplace: payload.marketplace,
      alertType: payload.type,
      context: 'client',
    });
  }

  return { sent, error: res.error };
}
