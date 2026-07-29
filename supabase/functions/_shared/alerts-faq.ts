/**
 * Inline FAQ tree for @PriceGuardAlertsBot (callback_data faq:*).
 */

import { CHROME_WEB_STORE_URL, CHROME_WEB_STORE_REVIEWS_URL } from './telegram.ts';

export type FaqInlineBtn =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type FaqKeyboard = FaqInlineBtn[][];

const SUPPORT_URL = 'https://t.me/priceguard_supportbot';

export function faqRootKeyboard(): FaqKeyboard {
  return [
    [{ text: '⬇️ Установить расширение', url: CHROME_WEB_STORE_URL }],
    [{ text: '⭐ Оставить отзыв', url: CHROME_WEB_STORE_REVIEWS_URL }],
    [{ text: '📦 Как добавить товар', callback_data: 'faq:add' }],
    [{ text: '💰 Почему другая цена', callback_data: 'faq:price' }],
    [{ text: '🔍 Почему не найден', callback_data: 'faq:notfound' }],
    [{ text: '✨ Как работает AI', callback_data: 'faq:ai' }],
    [{ text: '🗑 Как удалить товар', callback_data: 'faq:delete' }],
    [{ text: '👑 Premium', callback_data: 'faq:premium' }],
    [{ text: '🛍 Маркетплейсы', callback_data: 'faq:mp' }],
    [
      { text: '📬 Дайджест вкл/выкл', callback_data: 'faq:digest' },
      { text: '💬 Поддержка', url: SUPPORT_URL },
    ],
  ];
}

export function faqBackKeyboard(): FaqKeyboard {
  return [
    [{ text: '⬇️ Установить расширение', url: CHROME_WEB_STORE_URL }],
    [{ text: '⭐ Оставить отзыв', url: CHROME_WEB_STORE_REVIEWS_URL }],
    [{ text: '⬅️ Назад к FAQ', callback_data: 'faq:root' }],
    [{ text: '💬 Написать в поддержку', url: SUPPORT_URL }],
  ];
}

export function faqDigestKeyboard(enabled: boolean): FaqKeyboard {
  return [
    [
      enabled
        ? { text: '🔕 Выключить дайджест', callback_data: 'st:digest_off' }
        : { text: '🔔 Включить дайджест', callback_data: 'st:digest_on' },
    ],
    [{ text: '⬅️ Назад к FAQ', callback_data: 'faq:root' }],
  ];
}

export function buildFaqRootMessage(): string {
  return [
    '❓ <b>FAQ PriceGuard Alerts</b>',
    '',
    'Выберите тему:',
  ].join('\n');
}

export function buildFaqAnswer(topic: string): string | null {
  switch (topic) {
    case 'add':
      return [
        '📦 <b>Как добавить товар</b>',
        '',
        '1. Пришлите ссылку на карточку WB / Ozon / Я.Маркет',
        '2. Или кнопка «🔔 Следить» на карточке AI',
        '3. Или /add + ссылка',
        '',
        'Нужны вход в расширении и Chat ID в Настройках.',
        `⬇️ Нет расширения? ${CHROME_WEB_STORE_URL}`,
      ].join('\n');
    case 'price':
      return [
        '💰 <b>Почему цена в боте другая</b>',
        '',
        'Бот и серверный мониторинг смотрят <b>публичную/серверную</b> цену — без вашего входа на Ozon/WB/Маркет.',
        '',
        'В аккаунте на площадке цена может отличаться из‑за:',
        '• региона и склада',
        '• персональных скидок / карт лояльности',
        '• акций только для авторизованных',
        '',
        'Точнее «ваша» цена — в расширении на открытой карточке товара (сессия Chrome).',
        'Алерты в Telegram полезны как ориентир падения на площадке.',
      ].join('\n');
    case 'notfound':
      return [
        '🔍 <b>Почему товар не найден</b>',
        '',
        '• Отключите VPN или выберите сервер в РФ',
        '• Отключите adblock на wildberries.ru / ozon.ru / market.yandex.ru',
        '• Обновите карточку / «Найти заново» в расширении',
        '• Убедитесь, что ссылка ведёт на карточку товара, не на поиск',
      ].join('\n');
    case 'ai':
      return [
        '✨ <b>Как работает AI</b>',
        '',
        'Анализ строится по отзывам и сохраняется в кэш (~7 дней).',
        'В списке «Мои товары» кнопка «Анализ» сначала читает кэш — без лишних запросов.',
        '«Обновить анализ» запускает новый разбор по запросу.',
        '',
        'Free в расширении: до 3 полных AI/сутки после входа.',
      ].join('\n');
    case 'delete':
      return [
        '🗑 <b>Как удалить товар</b>',
        '',
        '1. «Мои товары» → кнопка «Удалить» под карточкой → подтвердите',
        '2. Или в расширении → «Мои товары»',
        '3. Fallback: <code>/remove https://…</code>',
      ].join('\n');
    case 'premium':
      return [
        '👑 <b>Free и Premium</b>',
        '',
        'Free: до 5 товаров в мониторинге, алерты, AI с лимитом.',
        'Premium: до 50 товаров + приоритет проверки без Chrome.',
        '',
        'Пробный период — после подключения Telegram в Настройках (один раз на Chat ID).',
        'Оформление: вкладка Premium в расширении или @priceguard_supportbot',
        `⬇️ Установка: ${CHROME_WEB_STORE_URL}`,
      ].join('\n');
    case 'mp':
      return [
        '🛍 <b>Маркетплейсы</b>',
        '',
        '• wildberries.ru',
        '• ozon.ru',
        '• market.yandex.ru',
        '',
        'Сравнение цен в боте берёт уже сохранённые данные (расширение / кэш), без нового поиска.',
      ].join('\n');
    case 'digest':
      return [
        '📬 <b>Утренний дайджест</b>',
        '',
        'Раз в день — кратко: что подешевело / подорожало и минимумы.',
        'Без AI и без нового scraping. Можно включить или выключить ниже.',
      ].join('\n');
    default:
      return null;
  }
}
