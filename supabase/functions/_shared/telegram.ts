import { sanitizeAlertButtonUrl } from './safe-url.ts';

/**
 * Общие хелперы Telegram для @PriceGuardAlertsBot
 * HTML parse_mode + inline-кнопка «Открыть товар»
 */

/**
 * Публичная страница расширения (CWS).
 * Keep in sync with extension `src/lib/store-config.ts` → chrome.*
 * Do not set Edge/Yandex here until real store URLs exist (never fake IDs).
 */
export const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf';

/** Страница отзывов в Chrome Web Store */
export const CHROME_WEB_STORE_REVIEWS_URL = `${CHROME_WEB_STORE_URL}/reviews`;

/** Telegram-канал с разборами (не алерты о цене) */
export const TELEGRAM_CHANNEL_URL = 'https://t.me/priceguard_ai';

/** Подпись кнопки на канал — везде одинаковая */
export const TELEGRAM_CHANNEL_BUTTON = 'Канал с разборами';

/**
 * Server-side price sources (Telegram / update-prices / shared scrape cache).
 * Not personal account prices from the user's Chrome session.
 */
export type TelegramPriceSource = 'cache' | 'scrappey' | 'legacy' | 'server';

/** Short caption for TG messages */
export function priceSourceCaption(source?: TelegramPriceSource | null): string {
  if (source === 'cache') return 'из кэша (серверная проверка)';
  return 'серверная проверка';
}

/** Disclaimer: bot price ≠ personal marketplace account price */
export const SERVER_PRICE_DISCLAIMER =
  'ℹ️ Цена по <b>серверной проверке</b>; в вашем аккаунте на площадке может отличаться (регион, скидки).';

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
  priceSource?: TelegramPriceSource | null;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const drop = input.oldPrice - input.newPrice;
  const pct = input.oldPrice > 0
    ? Math.round((drop / input.oldPrice) * 1000) / 10
    : 0;
  const mp = marketplaceLabel(input.marketplace);
  const mpLine = mp ? `\n🏷 ${escapeHtml(mp)}` : '';
  const head = input.priority
    ? '📉⚡ <b>Цена упала на площадке!</b> <i>(приоритет Premium)</i>'
    : '📉 <b>Цена упала на площадке!</b>';

  return [
    head,
    '',
    `🛍 <b>${title}</b>${mpLine}`,
    '',
    `💸 Было: <s>${formatRub(input.oldPrice)}</s>`,
    `✅ Стало: <b>${formatRub(input.newPrice)}</b>`,
    `📊 Выгода: <b>−${formatRub(drop)}</b> (−${pct}%)`,
    '',
    `📡 ${escapeHtml(priceSourceCaption(input.priceSource ?? 'server'))}`,
    SERVER_PRICE_DISCLAIMER,
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
    SERVER_PRICE_DISCLAIMER,
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
  priceSource?: TelegramPriceSource | null;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const mp = marketplaceLabel(input.marketplace);
  const mpLine = mp ? `\n🏷 ${escapeHtml(mp)}` : '';
  const head = input.priority
    ? '🎯⚡ <b>Целевая цена на площадке!</b> <i>(приоритет Premium)</i>'
    : '🎯 <b>Целевая цена на площадке!</b>';

  return [
    head,
    '',
    `🛍 <b>${title}</b>${mpLine}`,
    '',
    `✅ Сейчас: <b>${formatRub(input.currentPrice)}</b>`,
    `🎯 Цель: ${formatRub(input.targetPrice)}`,
    '',
    `📡 ${escapeHtml(priceSourceCaption(input.priceSource ?? 'server'))}`,
    SERVER_PRICE_DISCLAIMER,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

/** Приветствие /start — Chat ID пользователя */
/** Reply keyboard labels (must match telegram-webhook text handlers). */
export const REPLY_BTN_STATUS = '📦 Мои товары';
export const REPLY_BTN_AI = '✨ AI-анализ';
export const REPLY_BTN_FAQ = '❓ FAQ';
export const REPLY_BTN_HELP = 'ℹ️ Помощь';
export const REPLY_BTN_CHANNEL = TELEGRAM_CHANNEL_BUTTON;

export function alertsMainReplyKeyboard(): {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard: true;
  is_persistent: true;
} {
  return {
    keyboard: [
      [{ text: REPLY_BTN_STATUS }, { text: REPLY_BTN_AI }],
      [{ text: REPLY_BTN_FAQ }, { text: REPLY_BTN_HELP }],
      [{ text: REPLY_BTN_CHANNEL }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Inline URL-кнопка на канал (отдельно от алертов о цене). */
export function telegramChannelInlineRow(): Array<{ text: string; url: string }> {
  return [{ text: TELEGRAM_CHANNEL_BUTTON, url: TELEGRAM_CHANNEL_URL }];
}

export function buildStartWelcomeMessage(chatId: string | number): string {
  return [
    '👋 <b>PriceGuard Alerts</b>',
    '',
    'Цены WB / Ozon / Маркет · AI по ссылке · алерты без Chrome.',
    '',
    '✨ <b>Умею:</b>',
    '• следить за ценой и писать при падении',
    '• AI-разбор по ссылке (из кэша или заново)',
    '• сравнение площадок из сохранённых данных',
    '',
    '🔗 <b>Отправьте ссылку</b> на товар — или выберите кнопку ниже.',
    '',
    '📋 Привязка: расширение → Аккаунт → Настройки → Telegram',
    `Chat ID: <code>${escapeHtml(String(chatId))}</code> → «Подключить и проверить»`,
    '',
    `⬇️ Установить расширение: ${CHROME_WEB_STORE_URL}`,
    'Поддержка: @priceguard_supportbot',
  ].join('\n');
}

export function buildHelpMessage(): string {
  return [
    'ℹ️ <b>Справка</b>',
    '',
    '🔗 Ссылка на товар → AI-карточка и кнопки',
    '📦 «Мои товары» — список с анализом / сравнением / удалением',
    '❓ FAQ — частые вопросы',
    '',
    '/start · /status · /add · /help',
    '',
    '📉 Free: до 5 товаров · Premium: до 50 + приоритет',
    '',
    'Цена в боте — по серверной проверке (может отличаться от вашего аккаунта на Ozon/WB/Маркет).',
    `⬇️ Chrome Web Store: ${CHROME_WEB_STORE_URL}`,
    '💬 @priceguard_supportbot',
  ].join('\n');
}

/** Short status card body (one product message). */
export function buildTrackedItemCardMessage(item: {
  title: string;
  marketplace?: string | null;
  lastPrice?: number | null;
  targetPrice?: number | null;
  lastChecked?: string | null;
  lastFetchError?: string | null;
  minLine?: string | null;
}): string {
  const title = escapeHtml(truncateTitle(item.title || 'Товар', 80));
  const mp = marketplaceLabel(item.marketplace);
  const price =
    item.lastPrice != null && item.lastPrice > 0
      ? formatRub(Number(item.lastPrice))
      : '—';
  const target =
    item.targetPrice != null && Number(item.targetPrice) > 0
      ? ` · цель ${formatRub(Number(item.targetPrice))}`
      : '';
  const lines = [
    `🛍 <b>${title}</b>`,
    `💰 ${price}${target}${mp ? ` · ${escapeHtml(mp)}` : ''}`,
    `🕒 ${escapeHtml(formatCheckedAge(item.lastChecked))}${escapeHtml(fetchErrorHint(item.lastFetchError))}`,
    '📡 серверная проверка',
  ];
  if (item.minLine) lines.push(escapeHtml(item.minLine));
  return lines.join('\n');
}

export function trackedItemInlineKeyboard(ref: string): Array<
  Array<{ text: string; callback_data: string }>
> {
  return [
    [
      { text: '🤖 Анализ', callback_data: `st:ai:${ref}` },
      { text: '📊 Сравнение', callback_data: `st:cmp:${ref}` },
      { text: '🗑 Удалить', callback_data: `st:rm:${ref}` },
    ],
  ];
}

export function buildProductAddedMessage(input: {
  title: string;
  price: number;
  marketplace?: string | null;
  priceSource?: TelegramPriceSource | null;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const mp = marketplaceLabel(input.marketplace);
  const mpLine = mp ? `\n🏷 ${escapeHtml(mp)}` : '';

  return [
    '✅ <b>Товар добавлен в отслеживание!</b>',
    '',
    `🛍 <b>${title}</b>${mpLine}`,
    `💰 Цена на площадке: <b>${formatRub(input.price)}</b>`,
    `📡 ${escapeHtml(priceSourceCaption(input.priceSource ?? 'server'))}`,
    '',
    SERVER_PRICE_DISCLAIMER,
    '',
    'Сообщу, когда цена на площадке упадёт (по серверной проверке).',
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
  options?: {
    /** Всего active на сервере (может быть > items.length для Free) */
    totalCount?: number;
    /** Free: лимит мониторинга cron */
    freeLimit?: number;
  },
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

  const total = options?.totalCount ?? items.length;
  const freeLimit = options?.freeLimit;
  const header =
    freeLimit != null
      ? `📋 <b>Отслеживание</b> · ${items.length} из ${freeLimit} (мониторинг)${total > freeLimit ? ` · на сервере ${total}` : ''}`
      : `📋 <b>Отслеживание</b> · ${items.length} шт.`;

  const orphanHint =
    freeLimit != null && total > freeLimit
      ? [
          '',
          `⚠️ На сервере ${total} товаров — лишние не мониторятся.`,
          'Откройте расширение → «Мои товары» → «Обновить» для синхронизации.',
        ].join('\n')
      : '';

  return [
    header,
    '',
    ...lines,
    more,
    orphanHint,
    '',
    SERVER_PRICE_DISCLAIMER,
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
        'Пришлите ссылку WB / Ozon / Яндекс.Маркет — разберу отзывы и покажу вердикт AI с кнопками.',
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
        'Premium: до 50 товаров + приоритет проверки цен.',
        '',
        'Сайт · тарифы: https://priceguard-landing.vercel.app/#pricing',
        `⬇️ Расширение: ${CHROME_WEB_STORE_URL}`,
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
  /** Persistent reply keyboard under the input field */
  replyKeyboard?: {
    keyboard: Array<Array<{ text: string }>>;
    resize_keyboard?: boolean;
    is_persistent?: boolean;
  };
  removeKeyboard?: boolean;
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
  } else if (input.replyKeyboard) {
    payload.reply_markup = input.replyKeyboard;
  } else if (input.removeKeyboard) {
    payload.reply_markup = { remove_keyboard: true };
  } else {
    const safeButton = sanitizeAlertButtonUrl(input.buttonUrl);
    if (safeButton) {
      payload.reply_markup = {
        inline_keyboard: [[
          {
            text: input.buttonText ?? '🛒 Открыть товар',
            url: safeButton,
          },
        ]],
      };
    }
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
