/**
 * Общие хелперы Telegram для @PriceGuardAlertsBot
 * HTML parse_mode + inline-кнопка «Открыть товар»
 */

export interface TelegramSendResult {
  sent: boolean;
  error?: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export function truncateTitle(title: string, max = 120): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

const MARKETPLACE_LABELS: Record<string, string> = {
  wildberries: 'Wildberries',
  ozon: 'Ozon',
  yandex_market: 'Яндекс Маркет',
};

export function marketplaceLabel(mp?: string | null): string {
  if (!mp) return '';
  return MARKETPLACE_LABELS[mp] ?? mp;
}

/** Красивый алерт о падении цены */
export function buildPriceDropMessage(input: {
  title: string;
  oldPrice: number;
  newPrice: number;
  marketplace?: string | null;
  /** Premium: приоритетная проверка */
  priority?: boolean;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const drop = input.oldPrice - input.newPrice;
  const pct = input.oldPrice > 0
    ? Math.round((drop / input.oldPrice) * 1000) / 10
    : 0;
  const mp = marketplaceLabel(input.marketplace);
  const mpLine = mp ? `\n🏷 ${escapeHtml(mp)}` : '';
  const head = input.priority
    ? '📉⚡ <b>Цена упала!</b> <i>(приоритет Premium)</i>'
    : '📉 <b>Цена упала!</b>';

  return [
    head,
    '',
    `🛍 <b>${title}</b>${mpLine}`,
    '',
    `💸 Было: <s>${formatRub(input.oldPrice)}</s>`,
    `✅ Стало: <b>${formatRub(input.newPrice)}</b>`,
    `📊 Выгода: <b>−${formatRub(drop)}</b> (−${pct}%)`,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

/** Снижение цены на площадке в сравнении */
export function buildComparePriceDropMessage(input: {
  title: string;
  oldPrice: number;
  newPrice: number;
  marketplace?: string | null;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const drop = input.oldPrice - input.newPrice;
  const pct = input.oldPrice > 0
    ? Math.round((drop / input.oldPrice) * 1000) / 10
    : 0;
  const mp = marketplaceLabel(input.marketplace) || 'площадке';

  return [
    `📉 <b>Снижение цены на ${escapeHtml(mp)}</b>`,
    '',
    `🛍 <b>${title}</b>`,
    `🏷 ${escapeHtml(mp)}`,
    '',
    `💸 Было: <s>${formatRub(input.oldPrice)}</s>`,
    `✅ Стало: <b>${formatRub(input.newPrice)}</b>`,
    `📊 Выгода: <b>−${formatRub(drop)}</b> (−${pct}%)`,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

/** Нашли дешевле на другой площадке (сравнение) */
export function buildCheaperElsewhereMessage(input: {
  title: string;
  sourceMarketplace?: string | null;
  sourcePrice: number;
  cheaperMarketplace?: string | null;
  cheaperPrice: number;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const sourceMp = marketplaceLabel(input.sourceMarketplace) || 'источник';
  const cheapMp = marketplaceLabel(input.cheaperMarketplace) || 'другая площадка';
  const drop = input.sourcePrice - input.cheaperPrice;
  const pct = input.sourcePrice > 0
    ? Math.round((drop / input.sourcePrice) * 1000) / 10
    : 0;

  return [
    '💸 <b>Нашли дешевле на другой площадке!</b>',
    '',
    `🛍 <b>${title}</b>`,
    '',
    `📍 Источник: ${escapeHtml(sourceMp)} · ${formatRub(input.sourcePrice)}`,
    `✅ Дешевле: <b>${escapeHtml(cheapMp)}</b> · <b>${formatRub(input.cheaperPrice)}</b>`,
    `📊 Выгода: <b>−${formatRub(drop)}</b> (−${pct}%)`,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

/** Целевая цена достигнута */
export function buildTargetPriceMessage(input: {
  title: string;
  currentPrice: number;
  targetPrice: number;
  marketplace?: string | null;
  priority?: boolean;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const mp = marketplaceLabel(input.marketplace);
  const mpLine = mp ? `\n🏷 ${escapeHtml(mp)}` : '';
  const head = input.priority
    ? '🎯⚡ <b>Целевая цена достигнута!</b> <i>(приоритет Premium)</i>'
    : '🎯 <b>Целевая цена достигнута!</b>';

  return [
    head,    '',
    `🛍 <b>${title}</b>${mpLine}`,
    '',
    `✅ Сейчас: <b>${formatRub(input.currentPrice)}</b>`,
    `🎯 Цель: ${formatRub(input.targetPrice)}`,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

/** Приветствие /start — Chat ID пользователя */
export function buildStartWelcomeMessage(chatId: string | number): string {
  return [
    '👋 <b>Добро пожаловать в PriceGuard Alerts!</b>',
    '',
    'Я — <b>@PriceGuardAlertsBot</b>.',
    'Анализ товара по ссылке · алерты о цене · AI-вопросы.',
    '',
    '🔗 <b>Пришлите ссылку</b> на WB / Ozon / Яндекс.Маркет',
    '→ фото/карточка, AI Score, кнопки (недостатки, где дешевле, история…)',
    '',
    '📉 Алерты работают <b>без открытого Chrome</b>, если Chat ID привязан в расширении.',
    '',
    '📋 <b>Подключение алертов:</b>',
    '1️⃣ Расширение → «Аккаунт» (вход)',
    '2️⃣ Настройки → Telegram → <b>Вкл</b>',
    `3️⃣ Chat ID: <code>${escapeHtml(String(chatId))}</code>`,
    '4️⃣ «Подключить и проверить»',
    '',
    '❓ Расширение / ключ Premium: @priceguard_supportbot',
    '',
    '⌨️ /status · /add · /help · /chatid',
  ].join('\n');
}

export function buildHelpMessage(): string {
  return [
    'ℹ️ <b>Справка @PriceGuardAlertsBot</b>',
    '',
    '🔗 Ссылка на товар — AI-карточка (кэш / серверный разбор WB·Ozon·YM)',
    '/start — приветствие и Chat ID',
    '/status — список товаров и цены',
    '/add — только добавить в отслеживание',
    '/chatid — показать Chat ID',
    '/help — эта справка',
    '/cancel — выйти из режима вопроса AI',
    '',
    '📉 Алерты: Free до 5 товаров · Premium — без лимита + приоритет',
    '🤖 Free AI в расширении: до 3 полных анализов/сутки (после входа)',
    '💬 Вопросы по расширению — @priceguard_supportbot',
  ].join('\n');
}

export function buildProductAddedMessage(input: {
  title: string;
  price: number;
  marketplace?: string | null;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const mp = marketplaceLabel(input.marketplace);
  const mpLine = mp ? `\n🏷 ${escapeHtml(mp)}` : '';

  return [
    '✅ <b>Товар добавлен в отслеживание!</b>',
    '',
    `🛍 <b>${title}</b>${mpLine}`,
    `💰 Текущая цена: <b>${formatRub(input.price)}</b>`,
    '',
    'Я сообщу, когда цена упадёт.',
    'Список: /status',
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

function formatCheckedAge(lastChecked?: string | null): string {
  if (!lastChecked) return 'не обновлялось';
  const ms = Date.parse(lastChecked);
  if (!Number.isFinite(ms)) return 'не обновлялось';
  const hours = Math.max(0, Math.floor((Date.now() - ms) / (60 * 60 * 1000)));
  if (hours < 1) return 'только что';
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

function fetchErrorHint(error?: string | null): string {
  if (!error) return '';
  if (error.includes('ozon') || error.includes('ym') || error.includes('blocked')) {
    return ' · ⚠ маркетплейс блокирует';
  }
  if (error.includes('wb')) return ' · ⚠ нет цены WB';
  return ' · ⚠ ошибка обновления';
}

export function buildStatusMessage(
  items: Array<{
    title: string;
    marketplace?: string | null;
    lastPrice?: number | null;
    targetPrice?: number | null;
    lastChecked?: string | null;
    lastFetchError?: string | null;
  }>,
): string {
  if (items.length === 0) {
    return [
      '📦 <b>Список отслеживания пуст</b>',
      '',
      'Добавьте товары: пришлите ссылку сюда или через расширение → «Список».',
      'Нужны вход в «Аккаунт» и «Подключить и проверить» в Настройках.',
    ].join('\n');
  }

  const lines = items.slice(0, 25).map((item, i) => {
    const title = escapeHtml(truncateTitle(item.title || 'Товар', 60));
    const mp = marketplaceLabel(item.marketplace);
    const price =
      item.lastPrice != null && item.lastPrice > 0
        ? formatRub(Number(item.lastPrice))
        : '—';
    const target =
      item.targetPrice != null && Number(item.targetPrice) > 0
        ? ` · цель ${formatRub(Number(item.targetPrice))}`
        : '';
    const mpBit = mp ? ` · ${escapeHtml(mp)}` : '';
    const age = formatCheckedAge(item.lastChecked);
    const errHint = fetchErrorHint(item.lastFetchError);
    return `${i + 1}. <b>${title}</b>\n   💰 ${price}${target}${mpBit}\n   🕒 ${escapeHtml(age)}${escapeHtml(errHint)}`;
  });

  const more =
    items.length > 25
      ? `\n\n…и ещё ${items.length - 25} тов.`
      : '';

  return [
    `📋 <b>Отслеживание</b> · ${items.length} шт.`,
    '',
    ...lines,
    more,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].filter(Boolean).join('\n');
}

export function buildSupportErrorMessage(input: {
  message: string;
  context?: string;
  version?: string;
  userId?: string;
}): string {
  return [
    '🚨 <b>Ошибка расширения PriceGuard AI</b>',
    '',
    `💬 ${escapeHtml(truncateTitle(input.message, 500))}`,
    input.context ? `\n📍 <code>${escapeHtml(truncateTitle(input.context, 200))}</code>` : '',
    input.version ? `\n🧩 v${escapeHtml(input.version)}` : '',
    input.userId ? `\n👤 <code>${escapeHtml(input.userId.slice(0, 8))}…</code>` : '',
    '',
    `<i>${escapeHtml(new Date().toISOString())}</i>`,
  ].filter(Boolean).join('\n');
}

/** Автоответы на частые вопросы (без учёта регистра) */
export function matchFaqReply(text: string): string | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();

  const rules: Array<{ test: RegExp; reply: string }> = [
    {
      test: /как (подключ|настро|добав).*telegram|chat.?id|уведомлен/,
      reply: [
        '📲 <b>Как включить уведомления</b>',
        '',
        '1. Войдите в PriceGuard → «Аккаунт»',
        '2. Настройки → Telegram → Вкл',
        '3. Вставьте Chat ID из /chatid',
        '4. «Подключить и проверить»',
        '',
        'Затем пришлите ссылку на товар или добавьте его в «Список».',
      ].join('\n'),
    },
    {
      test: /как добав|следить|отслеж|ссылк|анализ/,
      reply: [
        '🔗 <b>Ссылка на товар</b>',
        '',
        'Пришлите ссылку WB / Ozon / Яндекс.Маркет — бот покажет карточку,',
        'AI Score (из кэша или серверный анализ для WB) и кнопки.',
        '',
        'Следить за ценой: кнопка «🔔» или команда <code>/add</code>.',
      ].join('\n'),
    },
    {
      test: /premium|премиум|платн|подписк/,
      reply: [
        '👑 <b>Premium</b>',
        '',
        'Free: до 5 товаров + алерты.',
        'Premium: без лимита + приоритет проверки цен.',
        '',
        'Сайт · тарифы: https://priceguard-landing.vercel.app/#pricing',
        'Оплата: расширение → вкладка Premium → ЮKassa.',
        'Алерты при закрытом Chrome — с Telegram (Free и Premium).',
        '',
        'Почта: priceguardAlsupp0rt@yandex.ru',
      ].join('\n'),
    },
    {
      test: /не приход|нет уведом|не работа|ошибк|баг/,
      reply: [
        '🛠 <b>Не приходят уведомления?</b>',
        '',
        '• Написали боту /start?',
        '• Telegram Вкл + верный Chat ID?',
        '• Товар в /status?',
        '• Порог падения в Настройках (₽ / %)?',
        '',
        'Поддержка: @priceguard_supportbot',
      ].join('\n'),
    },
    {
      test: /поддержк|support|помощ/,
      reply: [
        '💬 Поддержка расширения: <b>@priceguard_supportbot</b>',
        '',
        'Или кнопка «Поддержка» в Настройках PriceGuard AI.',
      ].join('\n'),
    },
    {
      test: /цена|паден|алерт|уведом/,
      reply: [
        '📉 <b>Алерты о цене</b>',
        '',
        'Free: до 5 товаров. Premium: неограниченно + приоритет.',
        'Проверяю отслеживаемые товары и пишу, когда цена упала',
        '(с кнопкой «Открыть товар»).',
        '',
        'Список: /status',
      ].join('\n'),
    },
  ];

  for (const rule of rules) {
    if (rule.test.test(t)) return rule.reply;
  }
  return null;
}

export async function sendTelegramMessage(input: {
  chatId: string;
  text: string;
  buttonUrl?: string;
  buttonText?: string;
  /** Inline keyboard (callback / url). Если задан — имеет приоритет над одной buttonUrl. */
  inlineKeyboard?: Array<Array<
    | { text: string; callback_data: string }
    | { text: string; url: string }
  >>;
  /** Переопределить токен (для @priceguard_supportbot) */
  botToken?: string;
}): Promise<TelegramSendResult> {
  const token =
    input.botToken?.trim() ||
    Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ||
    Deno.env.get('TELEGRAM_ALERTS_BOT_TOKEN')?.trim();
  if (!token) {
    return { sent: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  const chatId = input.chatId.trim();
  if (!chatId) {
    return { sent: false, error: 'chatId required' };
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: input.text.slice(0, 3900),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (input.inlineKeyboard && input.inlineKeyboard.length > 0) {
    payload.reply_markup = { inline_keyboard: input.inlineKeyboard };
  } else if (input.buttonUrl?.startsWith('http')) {
    payload.reply_markup = {
      inline_keyboard: [[
        {
          text: input.buttonText ?? '🛒 Открыть товар',
          url: input.buttonUrl.slice(0, 2000),
        },
      ]],
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      description?: string;
    };

    if (!response.ok || !body.ok) {
      return { sent: false, error: body.description ?? `HTTP ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Карточка с фото (caption ≤1024). При ошибке фото — вызывающий может fallback на sendMessage. */
export async function sendTelegramPhoto(input: {
  chatId: string;
  photoUrl: string;
  caption: string;
  inlineKeyboard?: Array<Array<
    | { text: string; callback_data: string }
    | { text: string; url: string }
  >>;
  botToken?: string;
}): Promise<TelegramSendResult> {
  const token =
    input.botToken?.trim() ||
    Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ||
    Deno.env.get('TELEGRAM_ALERTS_BOT_TOKEN')?.trim();
  if (!token) {
    return { sent: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  const chatId = input.chatId.trim();
  if (!chatId || !input.photoUrl.startsWith('http')) {
    return { sent: false, error: 'chatId and photoUrl required' };
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    photo: input.photoUrl.slice(0, 2000),
    caption: input.caption.slice(0, 1024),
    parse_mode: 'HTML',
  };
  if (input.inlineKeyboard && input.inlineKeyboard.length > 0) {
    payload.reply_markup = { inline_keyboard: input.inlineKeyboard };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      description?: string;
    };
    if (!response.ok || !body.ok) {
      return { sent: false, error: body.description ?? `HTTP ${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function answerTelegramCallback(input: {
  callbackQueryId: string;
  botToken?: string;
  text?: string;
}): Promise<void> {
  const token =
    input.botToken?.trim() ||
    Deno.env.get('TELEGRAM_SUPPORT_BOT_TOKEN')?.trim() ||
    Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: input.callbackQueryId,
        text: input.text?.slice(0, 200),
      }),
    });
  } catch {
    // ignore
  }
}
