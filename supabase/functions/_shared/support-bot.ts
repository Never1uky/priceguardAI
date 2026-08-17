/**
 * Тексты и меню для @priceguard_support
 * HTML parse_mode + inline-кнопки
 */

import {
  escapeHtml,
  formatRub,
  marketplaceLabel,
  truncateTitle,
  CHROME_WEB_STORE_URL,
  CHROME_WEB_STORE_REVIEWS_URL,
  TELEGRAM_CHANNEL_URL,
  TELEGRAM_CHANNEL_BUTTON,
} from './telegram.ts';

export const SUPPORT_BOT_USERNAME = 'priceguard_supportbot';
export const ALERTS_BOT_USERNAME = 'PriceGuardAlertsBot';
export const SUPPORT_EMAIL = 'priceguardAlsupp0rt@yandex.ru';
export const LANDING_PREMIUM_URL = 'https://priceguard-landing.vercel.app/#pricing';
export { CHROME_WEB_STORE_URL, CHROME_WEB_STORE_REVIEWS_URL, TELEGRAM_CHANNEL_URL, TELEGRAM_CHANNEL_BUTTON };

/** Цены как в PREMIUM_PLANS */
export const SUPPORT_PREMIUM_PRICES = {
  monthlyRub: 299,
  yearlyRub: 2490,
  yearlyMonthlyEquivalentRub: 208,
  savingsPercent: 30,
} as const;

export type InlineBtn =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type InlineKeyboard = InlineBtn[][];

/** Главное меню — inline (без дубля «Мои товары» — это @PriceGuardAlertsBot) */
export function supportMainMenuKeyboard(): InlineKeyboard {
  return [
    [{ text: '⬇️ Установить расширение', url: CHROME_WEB_STORE_URL }],
    [{ text: '⭐ Отзыв в Chrome Store', url: CHROME_WEB_STORE_REVIEWS_URL }],
    [{ text: '👑 Подписка Premium', callback_data: 'menu:premium' }],
    [{ text: '🛠 Сообщить о проблеме', callback_data: 'menu:problem' }],
    [{ text: '💬 Написать нам', callback_data: 'menu:review' }],
    [{ text: 'ℹ️ Справка', callback_data: 'menu:help' }],
    [{ text: TELEGRAM_CHANNEL_BUTTON, url: TELEGRAM_CHANNEL_URL }],
    [{ text: '📉 Бот алертов', url: `https://t.me/${ALERTS_BOT_USERNAME}` }],
  ];
}

/** Soft-redirect /status → alerts bot */
export function supportAlertsRedirectKeyboard(): InlineKeyboard {
  return [
    [{ text: '📦 Мои товары в боте алертов', url: `https://t.me/${ALERTS_BOT_USERNAME}` }],
    [{ text: '⬅️ В меню', callback_data: 'menu:home' }],
  ];
}

export function supportPremiumKeyboard(): InlineKeyboard {
  return [
    [{ text: '🌐 Сайт · тарифы и оплата', url: LANDING_PREMIUM_URL }],
    [{ text: '👑 Как оплатить в расширении', callback_data: 'menu:premium_how' }],
    [{ text: '⬅️ В меню', callback_data: 'menu:home' }],
  ];
}

export function supportAfterForwardKeyboard(): InlineKeyboard {
  return [
    [{ text: '⬅️ Главное меню', callback_data: 'menu:home' }],
  ];
}

/** После получения feedback — soft CTA на отзыв в CWS */
export function supportFeedbackThanksKeyboard(): InlineKeyboard {
  return [
    [{ text: '⭐ Оставить отзыв в Chrome Store', url: CHROME_WEB_STORE_REVIEWS_URL }],
    [{ text: '⬅️ Главное меню', callback_data: 'menu:home' }],
  ];
}

export function buildSupportStartMessage(chatId: string | number): string {
  return [
    '👋 <b>Привет! Это поддержка PriceGuard AI</b>',
    '',
    'Здесь: подписка, ключ, ошибки и отзывы.',
    `Список товаров, алерты и AI — в <b>@${ALERTS_BOT_USERNAME}</b>.`,
    '',
    `⬇️ Расширение: ${CHROME_WEB_STORE_URL}`,
    '',
    'Выберите действие в меню или напишите вопрос текстом —',
    'если не найду ответ, перешлю разработчику.',
    '',
    `🪪 Chat ID: <code>${escapeHtml(String(chatId))}</code>`,
  ].join('\n');
}

export function buildSupportHelpMessage(): string {
  return [
    'ℹ️ <b>Справка · @priceguard_supportbot</b>',
    '',
    '/start — главное меню',
    '/help — эта справка',
    '/premium — тарифы Premium',
    '/mykey — лицензионный ключ (если привязан)',
    '/feedback — отзыв или предложение',
    '',
    '📲 <b>Товары, алерты, AI</b>',
    `→ @${ALERTS_BOT_USERNAME} (кнопка «Мои товары», ссылка на товар)`,
    '1. /start у алерт-бота → скопируйте Chat ID',
    '2. Расширение → Аккаунт (вход)',
    '3. Настройки → Telegram → вставьте Chat ID → «Подключить»',
    '',
    '📦 Free: до 5 товаров + алерты + до 3 AI/сутки',
    '👑 Premium: до 50 товаров + приоритет без Chrome',
    '',
    '💰 Цены в боте алертов — серверная проверка (может отличаться от вашего аккаунта на площадке).',
    '',
    `📧 Почта: <code>${SUPPORT_EMAIL}</code>`,
    `🌐 Тарифы: ${LANDING_PREMIUM_URL}`,
    `⬇️ Chrome Web Store: ${CHROME_WEB_STORE_URL}`,
    `📢 ${TELEGRAM_CHANNEL_BUTTON}: ${TELEGRAM_CHANNEL_URL}`,
    '',
    'Не нашли ответ — напишите сюда обычным сообщением.',
  ].join('\n');
}

export function buildSupportStatusRedirectMessage(): string {
  return [
    '📦 <b>Список товаров</b>',
    '',
    `Отслеживание, кнопки анализа и сравнения — в боте алертов <b>@${ALERTS_BOT_USERNAME}</b>.`,
    '',
    'Привязка: /start у алерт-бота → Chat ID → Настройки расширения → Telegram.',
    '',
    'Здесь (support) — оплата, ключ и сообщения в поддержку.',
  ].join('\n');
}

export function buildSupportPremiumMessage(): string {
  const p = SUPPORT_PREMIUM_PRICES;
  return [
    '👑 <b>PriceGuard AI · Premium</b>',
    '',
    '<b>Что даёт Premium</b>',
    '• Неограниченный AI-анализ товаров',
    '• До 50 товаров в отслеживании',
    '• Алерты о цене + <b>приоритет</b> проверки (без открытого Chrome)',
    '• Сравнение по всем маркетплейсам · где дешевле',
    '• AI по ссылке в боте алертов',
    '',
    '<b>Цены</b>',
    `📅 1 месяц — <b>${formatRub(p.monthlyRub)}</b>`,
    `📆 1 год — <b>${formatRub(p.yearlyRub)}</b> (~${formatRub(p.yearlyMonthlyEquivalentRub)}/мес, −${p.savingsPercent}%)`,
    '',
    '<b>Как купить</b>',
    `1. Сайт с тарифами: ${LANDING_PREMIUM_URL}`,
    '2. В расширении: вкладка <b>Premium</b> → план → ЮKassa',
    '',
    `Проблемы с оплатой: <code>${SUPPORT_EMAIL}</code> или напишите сюда`,
    '',
    `Free (без оплаты): до 5 товаров + до 3 AI/сутки + алерты через @${ALERTS_BOT_USERNAME}`,
    'Premium / trial: до 50 товаров. Бесплатный период — после подключения Telegram в Настройках (один раз на Chat ID).',
  ].join('\n');
}

export function buildSupportPremiumHowMessage(): string {
  return [
    '🛒 <b>Оформление Premium</b>',
    '',
    `<b>Сайт:</b> ${LANDING_PREMIUM_URL}`,
    '',
    '<b>Оплата в расширении</b>',
    '1. Установите PriceGuard AI из Chrome Web Store (если ещё нет)',
    `   ${CHROME_WEB_STORE_URL}`,
    '2. Откройте popup расширения PriceGuard AI',
    '3. Вкладка «Premium» (или значок короны)',
    '4. Выберите «1 месяц» или «1 год»',
    '5. Оплатите через ЮKassa',
    '',
    'После оплаты Premium активируется автоматически.',
    `Проблемы с оплатой — напишите сюда или на <code>${SUPPORT_EMAIL}</code>.`,
  ].join('\n');
}

export function buildSupportFeedbackPrompt(kind: 'review' | 'problem' | 'feedback'): string {
  if (kind === 'problem') {
    return [
      '🛠 <b>Сообщить о проблеме</b>',
      '',
      'Опишите одним сообщением:',
      '• что случилось',
      '• маркетплейс / товар (если есть)',
      '• версию расширения (если знаете)',
      '',
      'Я перешлю сообщение разработчику.',
      'Или /cancel — отмена.',
    ].join('\n');
  }
  if (kind === 'review') {
    return [
      '⭐ <b>Отзыв о PriceGuard AI</b>',
      '',
      'Напишите, что нравится или что улучшить — одним сообщением.',
      'Перешлю разработчику.',
      '',
      'Или /cancel — отмена.',
    ].join('\n');
  }
  return [
    '💬 <b>Обратная связь</b>',
    '',
    'Отзыв, идея или жалоба — одним сообщением.',
    'Перешлю разработчику. /cancel — отмена.',
  ].join('\n');
}

export function buildSupportFeedbackThanks(): string {
  return [
    '✅ <b>Спасибо!</b>',
    '',
    'Сообщение передано разработчику.',
    'Ответим здесь, если понадобится уточнение.',
    '',
    'Если расширение помогает — отзыв в Chrome Web Store очень поддерживает проект 🙏',
  ].join('\n');
}

export function buildSupportAlertsHowMessage(): string {
  return [
    '📲 <b>Как подключить уведомления</b>',
    '',
    `1. Откройте @${ALERTS_BOT_USERNAME} → /start`,
    '2. Скопируйте Chat ID',
    '3. PriceGuard → Аккаунт (войдите)',
    '4. Настройки → Telegram → Вкл',
    '5. Вставьте Chat ID → «Подключить и проверить»',
    '',
    'Free и Premium получают алерты; Premium — с приоритетом.',
  ].join('\n');
}

export function buildSupportTroubleshootMessage(): string {
  return [
    '🛠 <b>Что делать при проблемах</b>',
    '',
    '1. Обновите расширение / перезагрузите Chrome',
    '2. Проверьте вход во вкладке «Аккаунт»',
    '3. Telegram: Chat ID и «Подключить и проверить»',
    `4. Список товаров: /status здесь или в @${ALERTS_BOT_USERNAME}`,
    '5. Пустой поиск / not_found на WB/Ozon: отключите VPN или adblock на wildberries.ru / ozon.ru / market.yandex.ru (или сервер VPN в РФ), обновите карточку',
    '6. Не помогло — опишите проблему текстом (меню «Сообщить о проблеме»)',
  ].join('\n');
}

export function buildSupportSearchVpnAdblockMessage(): string {
  return [
    '🔍 <b>Пустой поиск по площадкам</b>',
    '',
    'Поиск не удался — отключите VPN или adblock на wildberries.ru / ozon.ru / market.yandex.ru.',
    'Либо выберите сервер VPN в РФ, затем обновите карточку / «Найти заново».',
  ].join('\n');
}

export function buildSupportStatusMessage(
  items: Array<{
    title: string;
    marketplace?: string | null;
    lastPrice?: number | null;
    previousPrice?: number | null;
    targetPrice?: number | null;
  }>,
): string {
  if (items.length === 0) {
    return [
      '📦 <b>Список отслеживания пуст</b>',
      '',
      'Добавьте товары в расширении → «Список»',
      `или пришлите ссылку боту @${ALERTS_BOT_USERNAME}.`,
      '',
      'Нужна привязка Telegram в Настройках.',
    ].join('\n');
  }

  const lines = items.slice(0, 25).map((item, i) => {
    const title = escapeHtml(truncateTitle(item.title || 'Товар', 55));
    const mp = marketplaceLabel(item.marketplace);
    const price =
      item.lastPrice != null && item.lastPrice > 0
        ? formatRub(Number(item.lastPrice))
        : '—';
    let change = '';
    if (
      item.previousPrice != null &&
      item.previousPrice > 0 &&
      item.lastPrice != null &&
      item.lastPrice > 0 &&
      item.previousPrice !== item.lastPrice
    ) {
      const delta = Number(item.lastPrice) - Number(item.previousPrice);
      const sign = delta < 0 ? '↓' : '↑';
      change = ` · ${sign}${formatRub(Math.abs(delta))}`;
    }
    const target =
      item.targetPrice != null && Number(item.targetPrice) > 0
        ? ` · цель ${formatRub(Number(item.targetPrice))}`
        : '';
    const mpBit = mp ? `\n   🏷 ${escapeHtml(mp)}` : '';
    return `${i + 1}. <b>${title}</b>${mpBit}\n   💰 ${price}${change}${target}`;
  });

  const more =
    items.length > 25 ? `\n\n…и ещё ${items.length - 25} тов.` : '';

  return [
    `📋 <b>Ваши товары</b> · ${items.length} шт.`,
    '',
    ...lines,
    more,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].filter(Boolean).join('\n');
}

export function buildSupportForwardToDev(input: {
  fromChatId: string;
  fromUsername?: string;
  fromName?: string;
  kind: string;
  text: string;
}): string {
  const who = [
    input.fromName ? escapeHtml(input.fromName) : '',
    input.fromUsername ? `@${escapeHtml(input.fromUsername)}` : '',
  ].filter(Boolean).join(' ');

  return [
    `📨 <b>Обращение в поддержку</b> · ${escapeHtml(input.kind)}`,
    '',
    `👤 ${who || 'пользователь'}`,
    `🪪 chat: <code>${escapeHtml(input.fromChatId)}</code>`,
    '',
    escapeHtml(truncateTitle(input.text, 1200)),
    '',
    '↩️ <b>Как ответить:</b> Reply на это сообщение',
    `или <code>/reply ${escapeHtml(input.fromChatId)} ваш текст</code>`,
    '',
    `<i>${escapeHtml(new Date().toISOString())}</i>`,
  ].join('\n');
}

/** Извлечь chat id пользователя из форварда админу */
export function extractUserChatIdFromForward(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(/chat:\s*(?:<code>)?(\d+)(?:<\/code>)?/i)
    ?? text.match(/\/reply\s+(\d+)/i);
  return match?.[1] ?? null;
}

/** FAQ автоответы для support-бота */
export function matchSupportFaqReply(text: string): string | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();

  const rules: Array<{ test: RegExp; reply: string }> = [
    {
      test: /^(привет|здравствуй|добрый|hello|hi)\b/,
      reply: [
        '👋 <b>Здравствуйте!</b>',
        '',
        'Я бот поддержки PriceGuard AI.',
        'Выберите пункт меню или напишите вопрос.',
        '',
        'Команды: /start · /help · /status · /premium · /mykey · /feedback',
      ].join('\n'),
    },
    {
      test: /установ|chrome.?web.?store|скачать расширен|где (скачать|взять|установить)|cws/,
      reply: [
        '⬇️ <b>Установка PriceGuard AI</b>',
        '',
        CHROME_WEB_STORE_URL,
        '',
        'После установки: Аккаунт → вход → Настройки → Telegram (Chat ID из @PriceGuardAlertsBot).',
      ].join('\n'),
    },
    {
      test: /как (подключ|настро).*telegram|chat.?id|уведомлен|алерт/,
      reply: buildSupportAlertsHowMessage(),
    },
    {
      test: /premium|премиум|платн|подписк|сколько стоит|цена подписк/,
      reply: buildSupportPremiumMessage(),
    },
    {
      test: /vpn|adblock|адблок|блокировщик|пустой поиск|поиск пуст|поиск не удал|(не\s*наход).{0,40}(товар|выдач|площад|wb|озон|ozon)/,
      reply: buildSupportSearchVpnAdblockMessage(),
    },
    {
      test: /не приход|нет уведом|не работа|ошибк|баг|сломал|проблем/,
      reply: buildSupportTroubleshootMessage(),
    },
    {
      test: /отзыв|оценк|нрав/,
      reply: buildSupportFeedbackPrompt('review'),
    },
  ];

  for (const rule of rules) {
    if (rule.test.test(t)) return rule.reply;
  }
  return null;
}
