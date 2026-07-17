// PriceGuard AI — уведомления о ценах через @PriceGuardAlertsBot
//
// POST {
//   chatId: string,
//   message?: string,          // произвольный HTML-текст (fallback)
//   url?: string,              // кнопка «Открыть товар»
//   type?: 'price_drop' | 'target_price' | 'generic' | 'cheaper_elsewhere',
//   title?: string,
//   oldPrice?: number,
//   newPrice?: number,
//   targetPrice?: number,
//   marketplace?: string,      // для cheaper_elsewhere — дешёвая площадка
//   sourceMarketplace?: string,
//   sourcePrice?: number,
//   buttonText?: string,
// }
// Secrets: TELEGRAM_BOT_TOKEN

import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import {
  buildCheaperElsewhereMessage,
  buildPriceDropMessage,
  buildTargetPriceMessage,
  sendTelegramMessage,
} from '../_shared/telegram.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const chatId = String(body.chatId ?? '').slice(0, 32);
    const url = body.url ? String(body.url).slice(0, 2000) : undefined;
    const type = String(body.type ?? 'generic');
    const buttonText = body.buttonText ? String(body.buttonText).slice(0, 64) : undefined;

    if (!chatId) {
      return jsonResponse({ ok: false, error: 'chatId required' }, 400);
    }

    let text = body.message ? String(body.message).slice(0, 3500) : '';

    if (type === 'price_drop' && body.title != null && body.oldPrice != null && body.newPrice != null) {
      text = buildPriceDropMessage({
        title: String(body.title),
        oldPrice: Number(body.oldPrice),
        newPrice: Number(body.newPrice),
        marketplace: body.marketplace ? String(body.marketplace) : undefined,
      });
    } else if (
      type === 'cheaper_elsewhere' &&
      body.title != null &&
      (body.sourcePrice != null || body.oldPrice != null) &&
      body.newPrice != null
    ) {
      text = buildCheaperElsewhereMessage({
        title: String(body.title),
        sourceMarketplace: body.sourceMarketplace
          ? String(body.sourceMarketplace)
          : undefined,
        sourcePrice: Number(body.sourcePrice ?? body.oldPrice),
        cheaperMarketplace: body.marketplace ? String(body.marketplace) : undefined,
        cheaperPrice: Number(body.newPrice),
      });
    } else if (
      type === 'target_price' &&
      body.title != null &&
      body.newPrice != null &&
      body.targetPrice != null
    ) {
      text = buildTargetPriceMessage({
        title: String(body.title),
        currentPrice: Number(body.newPrice),
        targetPrice: Number(body.targetPrice),
        marketplace: body.marketplace ? String(body.marketplace) : undefined,
      });
    }
    // type === 'generic' → оставляем body.message

    if (!text) {
      return jsonResponse({ ok: false, error: 'message or structured alert required' }, 400);
    }

    const result = await sendTelegramMessage({
      chatId,
      text,
      buttonUrl: url,
      buttonText: buttonText ?? (url ? '🛒 Открыть товар' : undefined),
    });

    return jsonResponse({ ok: true, sent: result.sent, error: result.error ?? null });
  } catch (error) {
    console.error('[price-alert-notify]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
