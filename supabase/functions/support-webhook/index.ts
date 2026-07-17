/**
 * Webhook для @priceguard_support
 *
 * Команды: /start /help /status /premium /mykey /feedback
 * Inline-меню: Premium · Проблема · Отзыв · Товары · Справка
 * FAQ автоответы; остальное → TELEGRAM_SUPPORT_CHAT_ID
 *
 * Secrets:
 *   TELEGRAM_SUPPORT_BOT_TOKEN  — токен @priceguard_support
 *   TELEGRAM_SUPPORT_CHAT_ID    — чат разработчика (куда слать обращения)
 *   TELEGRAM_SUPPORT_WEBHOOK_SECRET (optional)
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse } from '../_shared/utils.ts';
import {
  answerTelegramCallback,
  escapeHtml,
  sendTelegramMessage,
} from '../_shared/telegram.ts';
import {
  buildSupportFeedbackPrompt,
  buildSupportFeedbackThanks,
  buildSupportForwardToDev,
  buildSupportHelpMessage,
  buildSupportPremiumHowMessage,
  buildSupportPremiumMessage,
  buildSupportStartMessage,
  buildSupportStatusMessage,
  extractUserChatIdFromForward,
  matchSupportFaqReply,
  supportAfterForwardKeyboard,
  supportMainMenuKeyboard,
  supportPremiumKeyboard,
  type InlineKeyboard,
} from '../_shared/support-bot.ts';

interface TelegramUser {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
    from?: TelegramUser;
    reply_to_message?: {
      text?: string;
      caption?: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: TelegramUser;
    message?: { chat?: { id?: number } };
  };
}

/** Ожидание ответа пользователя: chatId → kind (edge memory, best-effort) */
const pendingByChat = new Map<string, { kind: string; at: number }>();
const PENDING_TTL_MS = 30 * 60 * 1000;

/** Rate-limit /mykey: 1 раз / 5 мин на chat (edge memory, best-effort) */
const mykeyLastAtByChat = new Map<string, number>();
const MYKEY_COOLDOWN_MS = 5 * 60 * 1000;

function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key);
}

function supportBotToken(): string | null {
  return (
    Deno.env.get('TELEGRAM_SUPPORT_BOT_TOKEN')?.trim() ||
    Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ||
    null
  );
}

function adminChatId(): string | null {
  return (
    Deno.env.get('TELEGRAM_SUPPORT_CHAT_ID')?.trim() ||
    Deno.env.get('TELEGRAM_CHAT_ID')?.trim() ||
    null
  );
}

function setPending(chatId: string, kind: string) {
  pendingByChat.set(chatId, { kind, at: Date.now() });
}

function takePending(chatId: string): string | null {
  const row = pendingByChat.get(chatId);
  if (!row) return null;
  if (Date.now() - row.at > PENDING_TTL_MS) {
    pendingByChat.delete(chatId);
    return null;
  }
  pendingByChat.delete(chatId);
  return row.kind;
}

async function getBotIdentity(token: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await res.json() as {
      ok?: boolean;
      description?: string;
      result?: { id?: number; username?: string };
    };
    if (!body.ok || !body.result) {
      return { ok: false as const, error: body.description ?? `HTTP ${res.status}` };
    }
    return {
      ok: true as const,
      id: body.result.id,
      username: body.result.username,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveUserId(
  supabase: SupabaseClient,
  chatId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_alert_settings')
    .select('user_id, telegram_enabled, server_monitoring, updated_at')
    .eq('telegram_chat_id', chatId)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[support-webhook] resolveUserId', error);
    return null;
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const active =
    rows.find((r) => r.telegram_enabled && r.server_monitoring) ??
    rows.find((r) => r.telegram_enabled) ??
    rows[0];

  return active?.user_id ?? null;
}

async function loadTrackedForUser(supabase: SupabaseClient, userId: string) {
  const { data: rows, error } = await supabase
    .from('tracked_products')
    .select('product_title, marketplace, last_price, target_price, last_checked, last_fetch_error, updated_at')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error) {
    console.error('[support-webhook] status', error);
    return [];
  }

  return (rows ?? []).map((r) => ({
    title: String(r.product_title ?? 'Товар'),
    marketplace: r.marketplace as string | null,
    lastPrice: r.last_price == null ? null : Number(r.last_price),
    targetPrice: r.target_price == null ? null : Number(r.target_price),
    lastChecked: (r.last_checked as string | null) ?? null,
    lastFetchError: (r.last_fetch_error as string | null) ?? null,
  }));
}

async function reply(
  chatId: string,
  text: string,
  keyboard?: InlineKeyboard,
) {
  const token = supportBotToken();
  if (!token) return { sent: false, error: 'no token' };
  return sendTelegramMessage({
    chatId,
    text,
    botToken: token,
    inlineKeyboard: keyboard,
  });
}

async function forwardToAdmin(input: {
  fromChatId: string;
  from?: TelegramUser;
  kind: string;
  text: string;
}) {
  const admin = adminChatId();
  const token = supportBotToken();
  if (!admin || !token) {
    console.warn('[support-webhook] admin chat or token missing');
    return { sent: false };
  }

  const name = [input.from?.first_name, input.from?.last_name]
    .filter(Boolean)
    .join(' ');

  return sendTelegramMessage({
    chatId: admin,
    botToken: token,
    text: buildSupportForwardToDev({
      fromChatId: input.fromChatId,
      fromUsername: input.from?.username,
      fromName: name || undefined,
      kind: input.kind,
      text: input.text,
    }),
  });
}

async function handleStatus(supabase: SupabaseClient | null, chatId: string) {
  if (!supabase) {
    return reply(chatId, '⚠️ Сервер временно недоступен.', supportMainMenuKeyboard());
  }
  const userId = await resolveUserId(supabase, chatId);
  if (!userId) {
    return reply(
      chatId,
      [
        '🔗 <b>Telegram ещё не привязан</b>',
        '',
        '1. @PriceGuardAlertsBot → /start → скопируйте Chat ID',
        '2. Расширение → Аккаунт → Настройки → Telegram',
        '3. Вставьте тот же Chat ID → «Подключить и проверить»',
        '',
        'После привязки /status покажет ваши товары.',
      ].join('\n'),
      supportMainMenuKeyboard(),
    );
  }
  const items = await loadTrackedForUser(supabase, userId);
  return reply(chatId, buildSupportStatusMessage(items), supportMainMenuKeyboard());
}

async function handleMyKey(supabase: SupabaseClient | null, chatId: string) {
  const lastAt = mykeyLastAtByChat.get(chatId) ?? 0;
  const elapsed = Date.now() - lastAt;
  if (elapsed < MYKEY_COOLDOWN_MS) {
    const waitMin = Math.ceil((MYKEY_COOLDOWN_MS - elapsed) / 60000);
    return reply(
      chatId,
      `⏳ Команда /mykey доступна раз в 5 минут. Подождите ещё ~${waitMin} мин.`,
      supportMainMenuKeyboard(),
    );
  }

  if (!supabase) {
    return reply(chatId, '⚠️ Сервер временно недоступен.', supportMainMenuKeyboard());
  }

  const userId = await resolveUserId(supabase, chatId);
  if (!userId) {
    return reply(
      chatId,
      [
        '🔗 <b>Telegram не привязан к аккаунту</b>',
        '',
        '1. @PriceGuardAlertsBot → /start → скопируйте Chat ID',
        '2. Расширение → войти в Аккаунт → Настройки → Telegram',
        '3. Вставьте Chat ID → «Подключить и проверить»',
        '',
        'После привязки /mykey покажет лицензионный ключ.',
      ].join('\n'),
      supportMainMenuKeyboard(),
    );
  }

  const { data: premium, error: premiumError } = await supabase
    .from('user_premium')
    .select('license_key_id, expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (premiumError) {
    console.error('[support-webhook] mykey premium', premiumError);
    return reply(chatId, '⚠️ Не удалось проверить лицензию. Попробуйте позже.', supportMainMenuKeyboard());
  }

  if (!premium?.license_key_id) {
    return reply(
      chatId,
      [
        '🔑 <b>Ключ не привязан к аккаунту</b>',
        '',
        'Войдите в расширение → Premium → вставьте ключ под аккаунтом.',
        'После активации ключ сохранится на аккаунте и /mykey его покажет.',
        '',
        'Если ключа нет — оформите Premium или напишите в поддержку.',
      ].join('\n'),
      supportMainMenuKeyboard(),
    );
  }

  if (premium.expires_at && new Date(premium.expires_at) <= new Date()) {
    return reply(
      chatId,
      '⌛️ Срок Premium истёк. Оформите подписку снова во вкладке Premium.',
      supportMainMenuKeyboard(),
    );
  }

  const { data: license, error: keyError } = await supabase
    .from('license_keys')
    .select('key_code, is_active, expires_at, plan')
    .eq('id', premium.license_key_id)
    .maybeSingle();

  if (keyError || !license?.key_code || !license.is_active) {
    return reply(
      chatId,
      '⚠️ Ключ не найден или деактивирован. Напишите в поддержку.',
      supportMainMenuKeyboard(),
    );
  }

  mykeyLastAtByChat.set(chatId, Date.now());

  const expiresLine = license.expires_at
    ? `Действует до: ${new Date(license.expires_at).toLocaleDateString('ru-RU')}`
    : license.plan === 'lifetime'
      ? 'Бессрочная лицензия'
      : '';

  return reply(
    chatId,
    [
      '🔑 <b>Ваш лицензионный ключ</b>',
      '',
      `<code>${license.key_code}</code>`,
      expiresLine,
      '',
      'Вставьте во вкладке Premium или просто войдите в аккаунт — Premium восстановится.',
      '',
      '⚠️ Не пересылайте ключ посторонним.',
    ].filter(Boolean).join('\n'),
    supportMainMenuKeyboard(),
  );
}

async function relayAdminReplyToUser(userChatId: string, adminText: string) {
  const body = [
    '💬 <b>Ответ поддержки</b>',
    '',
    escapeHtml(adminText.slice(0, 3500)),
  ].join('\n');

  const result = await sendTelegramMessage({
    chatId: userChatId,
    botToken: supportBotToken() ?? undefined,
    text: body,
  });

  return result;
}

/** Админский relay: только /reply или Reply на «Обращение в поддержку». */
function isAdminRelayMessage(text: string, replyToText?: string): boolean {
  if (/^\/reply(?:@\w+)?\s+\d+\s+\S/i.test(text)) return true;
  return Boolean(extractUserChatIdFromForward(replyToText));
}

async function handleAdminMessage(input: {
  chatId: string;
  text: string;
  replyToText?: string;
}): Promise<{ action: string; sent?: boolean; error?: string }> {
  const admin = adminChatId();
  if (!admin || input.chatId !== admin) {
    return { action: 'not_admin' };
  }

  // /reply <chatId> <текст>
  const replyCmd = input.text.match(/^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)$/i);
  if (replyCmd) {
    const userChatId = replyCmd[1]!;
    const replyText = replyCmd[2]!.trim();
    if (!replyText) {
      await reply(input.chatId, 'Формат: /reply &lt;chatId&gt; текст ответа');
      return { action: 'reply_usage' };
    }
    const result = await relayAdminReplyToUser(userChatId, replyText);
    await reply(
      input.chatId,
      result.sent
        ? `✅ Ответ отправлен пользователю <code>${userChatId}</code>`
        : `⚠️ Не удалось отправить: ${result.error ?? 'ошибка'}`,
    );
    return { action: '/reply', sent: result.sent, error: result.error };
  }

  // Reply на форвард обращения
  const userChatId = extractUserChatIdFromForward(input.replyToText);
  if (userChatId) {
    const result = await relayAdminReplyToUser(userChatId, input.text);
    await reply(
      input.chatId,
      result.sent
        ? `✅ Ответ отправлен пользователю <code>${userChatId}</code>`
        : `⚠️ Не удалось отправить: ${result.error ?? 'ошибка'}`,
    );
    return { action: 'reply_to_forward', sent: result.sent, error: result.error };
  }

  // /mykey, /status и т.д. — не админ-хинт, пусть обработает обычный пайплайн
  return { action: 'not_admin_passthrough' };
}

async function deliverFeedback(input: {
  chatId: string;
  from?: TelegramUser;
  kind: string;
  text: string;
}) {
  const fwd = await forwardToAdmin({
    fromChatId: input.chatId,
    from: input.from,
    kind: input.kind,
    text: input.text,
  });
  if (fwd.sent) {
    await reply(input.chatId, buildSupportFeedbackThanks(), supportMainMenuKeyboard());
    return { action: 'forwarded', sent: true };
  }
  await reply(
    input.chatId,
    [
      '⚠️ Не удалось отправить разработчику (чат поддержки не настроен).',
      'Напишите позже или проверьте TELEGRAM_SUPPORT_CHAT_ID.',
    ].join('\n'),
    supportMainMenuKeyboard(),
  );
  return { action: 'forward_failed', sent: false };
}

async function handleCallback(
  data: string,
  chatId: string,
  callbackId: string,
  supabase: SupabaseClient | null,
) {
  const token = supportBotToken() ?? undefined;
  await answerTelegramCallback({ callbackQueryId: callbackId, botToken: token });

  switch (data) {
    case 'menu:home':
      return reply(chatId, buildSupportStartMessage(chatId), supportMainMenuKeyboard());
    case 'menu:premium':
      return reply(chatId, buildSupportPremiumMessage(), supportPremiumKeyboard());
    case 'menu:premium_how':
      return reply(chatId, buildSupportPremiumHowMessage(), supportMainMenuKeyboard());
    case 'menu:help':
      return reply(chatId, buildSupportHelpMessage(), supportMainMenuKeyboard());
    case 'menu:status':
      return handleStatus(supabase, chatId);
    case 'menu:problem':
      setPending(chatId, 'проблема');
      return reply(chatId, buildSupportFeedbackPrompt('problem'), supportAfterForwardKeyboard());
    case 'menu:review':
      setPending(chatId, 'отзыв');
      return reply(chatId, buildSupportFeedbackPrompt('review'), supportAfterForwardKeyboard());
    default:
      return reply(chatId, 'Выберите пункт меню.', supportMainMenuKeyboard());
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }

  if (req.method === 'GET') {
    const token = supportBotToken();
    if (!token) {
      return jsonResponse({ ok: false, error: 'TELEGRAM_SUPPORT_BOT_TOKEN missing' });
    }
    const identity = await getBotIdentity(token);
    return jsonResponse({
      ok: identity.ok,
      expected: 'priceguard_supportbot',
      secretBot: identity,
      match:
        identity.username === 'priceguard_supportbot' ||
        identity.username === 'priceguard_support',
      commands: ['/start', '/help', '/status', '/premium', '/mykey', '/feedback', '/reply'],
      adminConfigured: Boolean(adminChatId()),
      adminReply: 'Reply to forward or /reply <chatId> text',
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const expectedSecret = Deno.env.get('TELEGRAM_SUPPORT_WEBHOOK_SECRET')?.trim();
  if (expectedSecret) {
    const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token')?.trim();
    if (got !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }
  }

  try {
    const update = (await req.json()) as TelegramUpdate;
    const supabase = serviceClient();

    if (update.callback_query?.id) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      if (chatId == null) {
        return jsonResponse({ ok: true, ignored: true });
      }
      await handleCallback(
        String(cq.data ?? ''),
        String(chatId),
        cq.id,
        supabase,
      );
      return jsonResponse({ ok: true, action: 'callback', data: cq.data });
    }

    const chatIdNum = update.message?.chat?.id;
    const text = (update.message?.text ?? '').trim();
    const from = update.message?.from;

    if (chatIdNum == null || !text) {
      return jsonResponse({ ok: true, ignored: true });
    }

    const chatId = String(chatIdNum);
    const command = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
    const replyToText =
      update.message?.reply_to_message?.text ??
      update.message?.reply_to_message?.caption;

    // Админ = тот же chat, что TELEGRAM_SUPPORT_CHAT_ID: перехватываем только relay
    const admin = adminChatId();
    if (admin && chatId === admin && isAdminRelayMessage(text, replyToText)) {
      const result = await handleAdminMessage({
        chatId,
        text,
        replyToText,
      });
      if (result.action !== 'not_admin_passthrough') {
        return jsonResponse({ ok: true, ...result });
      }
    }

    if (command === '/start') {
      pendingByChat.delete(chatId);
      await reply(chatId, buildSupportStartMessage(chatId), supportMainMenuKeyboard());
      return jsonResponse({ ok: true, action: '/start' });
    }

    if (command === '/help') {
      await reply(chatId, buildSupportHelpMessage(), supportMainMenuKeyboard());
      return jsonResponse({ ok: true, action: '/help' });
    }

    if (command === '/premium') {
      await reply(chatId, buildSupportPremiumMessage(), supportPremiumKeyboard());
      return jsonResponse({ ok: true, action: '/premium' });
    }

    if (command === '/status') {
      await handleStatus(supabase, chatId);
      return jsonResponse({ ok: true, action: '/status' });
    }

    if (command === '/mykey') {
      await handleMyKey(supabase, chatId);
      return jsonResponse({ ok: true, action: '/mykey' });
    }

    if (command === '/feedback') {
      setPending(chatId, 'feedback');
      await reply(chatId, buildSupportFeedbackPrompt('feedback'), supportAfterForwardKeyboard());
      return jsonResponse({ ok: true, action: '/feedback' });
    }

    if (command === '/cancel') {
      pendingByChat.delete(chatId);
      await reply(chatId, '❌ Отменено.', supportMainMenuKeyboard());
      return jsonResponse({ ok: true, action: '/cancel' });
    }

    if (text.startsWith('/')) {
      await reply(
        chatId,
        'Неизвестная команда.\n/start · /help · /status · /premium · /mykey · /feedback',
        supportMainMenuKeyboard(),
      );
      return jsonResponse({ ok: true, action: 'unknown_command' });
    }

    // После /feedback / проблема / отзыв — следующее сообщение уходит разработчику
    const pendingKind = takePending(chatId);
    if (pendingKind) {
      const result = await deliverFeedback({
        chatId,
        from,
        kind: pendingKind,
        text,
      });
      return jsonResponse({ ok: true, ...result });
    }

    const faq = matchSupportFaqReply(text);
    if (faq) {
      const wantsFeedback = /отзыв|оставьте|одним сообщением/i.test(faq);
      if (wantsFeedback) setPending(chatId, 'отзыв');
      await reply(
        chatId,
        faq,
        wantsFeedback ? supportAfterForwardKeyboard() : supportMainMenuKeyboard(),
      );
      return jsonResponse({ ok: true, action: 'faq' });
    }

    // Нет автоответа → переслать разработчику
    const result = await deliverFeedback({
      chatId,
      from,
      kind: 'сообщение',
      text,
    });
    return jsonResponse({ ok: true, action: 'forward_unknown', ...result });
  } catch (error) {
    console.error('[support-webhook]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
