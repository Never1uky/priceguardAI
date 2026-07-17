/**
 * Отправка price-alert в Telegram через Supabase Edge Function.
 * Chat ID задаётся пользователем в настройках расширения.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { makeReferralLinkAsync } from '@/utils/referral';
import type { Marketplace } from '@/types/product';

export interface TelegramPriceAlertPayload {
  chatId: string;
  message?: string;
  url?: string;
  marketplace?: Marketplace;
  /** Структурированный алерт — Edge сам соберёт красивый текст + кнопку */
  type?: 'price_drop' | 'target_price' | 'generic' | 'cheaper_elsewhere';
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
    return { sent: false, error: res?.error ?? 'Не удалось отправить в Telegram' };
  }

  return { sent: Boolean(res.sent), error: res.error };
}
