# Материалы для Chrome Web Store — PriceGuard AI

Версия расширения: **2.20.8**  
Категория: **Shopping**  
Язык листинга: **Русский** (основной), **English** (дополнительно)

Privacy Policy (публичный URL): https://priceguard-landing.vercel.app/privacy  
Контакт: priceguardAlsupp0rt@yandex.ru · Telegram поддержки: @priceguard_supportbot

---

## 0. Что сделать вручную перед загрузкой (чеклист оператора)

1. **Privacy URL** — `https://priceguard-landing.vercel.app/privacy` (или GitHub Pages `docs/privacy/`).
2. **Confirm email OFF** в Supabase Dashboard (Auth → Email), либо SMTP.
3. **5 скриншотов 1280×800**: popup «Цены и сравнение»; отслеживаемые; AI-анализ; Premium; Telegram + AI по ссылке.
4. **Smoke P0** на zip без debug: WB/Ozon/YM сравнение; вход; Premium restore; Telegram «Подключить»; AI по ссылке в @PriceGuardAlertsBot.
5. Загрузить **только** `priceguard-ai-v2.20.8.zip`. Сначала **Unlisted**, потом Public.
6. В форме CWS: Single purpose (§8), Permissions (§9), Data use: product URLs, prices, reviews, email (optional), device_id, Telegram chat id (optional); processors: Supabase, AI providers, Bright Data (server scrape), YooKassa, Telegram.

---

## 1. Короткое описание (до 132 символов)

### Русский (рекомендуется)

```
AI-анализ отзывов, сравнение цен WB/Ozon/Маркет и алерты в Telegram — даже без открытого Chrome.
```
*(109 символов)*

### Русский — альтернатива

```
Цены, скидки и AI-отзывы на Wildberries, Ozon и Яндекс.Маркет. Сравнение и уведомления о падении цены.
```
*(105 символов)*

### English

```
AI review insights, cross-store prices on WB/Ozon/Yandex Market & Telegram alerts — even without Chrome open.
```
*(109 characters)*

---

## 2. Полное описание (до 4000 символов)

### Русский

```
PriceGuard AI — умный помощник для покупок на Wildberries, Ozon и Яндекс.Маркет.

Сравнивайте цены между площадками, читайте AI-разбор отзывов и получайте алерты о падении цены в браузере и в Telegram — в том числе когда Chrome закрыт (серверный мониторинг).

🛒 ДЛЯ КОГО
• Покупатели WB, Ozon и Яндекс.Маркет
• Те, кто ищет, где дешевле, без ручного копирования ссылок
• Те, кто ждёт скидку и не хочет переплачивать
• Те, кому нужен короткий вердикт по отзывам вместо сотен комментариев

✨ ВОЗМОЖНОСТИ

🤖 AI-анализ отзывов и полный разбор товара
Плюсы, минусы, риск накрутки/подделки, вердикт «покупать / подождать». Free: до 3 полных AI-анализов в сутки (после входа). Premium — без лимита.

⚖️ Сравнение на трёх площадках
Один товар — таблица офферов WB / Ozon / Яндекс.Маркет. Сразу видно, где дешевле, переход в карточку в один клик.

📉 Отслеживание и история цен
Список «Отслеживаемое», целевая цена, график истории. Понятно, реальная ли скидка.

🔔 Алерты в браузере и Telegram
Подключите @PriceGuardAlertsBot: уведомления о падении цены и AI-карточка по ссылке на товар (кнопки: недостатки, где дешевле, история…). Поддержка — @priceguard_supportbot.

☁️ Без открытого Chrome
При включённом Telegram сервер проверяет цены по расписанию (Free — до 5 товаров; Premium — без лимита и с приоритетом).

🔒 БЕЗОПАСНОСТЬ
• Ключи AI не в расширении — запросы через защищённый сервер
• Подробности — в Политике конфиденциальности

💎 FREE И PREMIUM
Free: до 5 отслеживаемых, до 3 AI-анализов/сутки, сравнение, алерты.
Premium: безлимит AI и отслеживания, приоритетная проверка, полный пайплайн анализа.

🛍️ ПЛОЩАДКИ
• wildberries.ru · ozon.ru · market.yandex.ru

PriceGuard AI не аффилирован с маркетплейсами. Данные — с публичных страниц в момент запроса.

Установите PriceGuard AI и покупайте умнее.
```

### English

```
PriceGuard AI — a smart shopping assistant for Wildberries, Ozon and Yandex Market.

Compare prices across stores, get AI review insights, and receive price-drop alerts in the browser and Telegram — including when Chrome is closed (server monitoring).

🛒 WHO IT'S FOR
• Shoppers on WB, Ozon, Yandex Market
• Anyone looking for where it’s cheaper without copying links by hand
• Deal hunters waiting for a real discount
• Busy buyers who want a short review verdict

✨ FEATURES

🤖 AI review analysis & full product breakdown
Pros, cons, fake/manipulation risk, buy/wait verdict. Free: up to 3 full AI analyses per day (after sign-in). Premium: unlimited.

⚖️ Cross-marketplace compare
One product — WB / Ozon / Yandex Market offers in one table. See where it’s cheaper and open the listing in one click.

📉 Tracking & price history
Watchlist, target price, history chart — spot real discounts vs fake sales.

🔔 Browser & Telegram alerts
Connect @PriceGuardAlertsBot for price drops and AI cards from a product link. Support: @priceguard_supportbot.

☁️ Works without Chrome open
With Telegram enabled, the server checks prices on a schedule (Free: up to 5 products; Premium: unlimited + priority).

🔒 PRIVACY
• AI API keys never stored in the extension
• See our Privacy Policy

💎 FREE & PREMIUM
Free: up to 5 tracked, 3 AI/day, compare, alerts.
Premium: unlimited AI & tracking, priority checks, full analysis pipeline.

🛍️ STORES: Wildberries · Ozon · Yandex Market

Not affiliated with the marketplaces. Public page data at request time.

Install PriceGuard AI — shop smarter.
```

---

## 2b. What's New (поле «Что нового» для 2.20.8)

### Русский

```
• AI-анализ по ссылке в Telegram (@PriceGuardAlertsBot): карточка, кнопки, вопросы AI
• Серверный сбор отзывов Ozon/Я.Маркет + единый пайплайн анализа
• История цен на сервере и кнопка истории в боте
• Мониторинг цен без открытого Chrome при подключённом Telegram
• Обновлена Политика конфиденциальности (Bright Data, Telegram AI)
```

### English

```
• AI analysis from a product link in Telegram (@PriceGuardAlertsBot)
• Server-side Ozon/Yandex Market reviews + unified AI pipeline
• Server price history + history button in the bot
• Price monitoring without Chrome open when Telegram is connected
• Privacy Policy updated (Bright Data, Telegram AI)
```

---

## 3. Ключевые слова (для SEO в описании)

### Русский

| Группа | Ключевые слова |
|--------|----------------|
| Маркетплейсы | wildberries, вайлдберриз, wb, ozon, озон, яндекс маркет |
| Функции | отслеживание цен, сравнение цен, где дешевле, падение цены, история цен |
| AI | анализ отзывов, ai отзывы, полный анализ товара |
| Telegram | телеграм уведомления, алерты без chrome |
| Покупки | экономия, скидки, price tracker |

### English

```
price tracker, wildberries, ozon, yandex market, price drop alert, compare prices, AI review analysis, telegram alerts
```

---

## 4. Преимущества (промо / скриншоты)

1. **AI-анализ отзывов** — вердикт за минуты, не за час чтения.
2. **Где дешевле** — WB, Ozon и Маркет в одной таблице.
3. **Алерты без Chrome** — серверный мониторинг + Telegram.
4. **AI по ссылке в боте** — пришлите URL → карточка и кнопки.
5. **История цен** — отличить реальную скидку от «было выше на бумаге».
6. **Безопасный облачный AI** — ключи на сервере.
7. **Freemium** — 3 AI/день и до 5 товаров бесплатно.
8. **Синхронизация** — список и Telegram после входа в аккаунт.

---

## 5. Структура скриншотов (5 × 1280×800)

| # | Заголовок | Что показать |
|---|-----------|--------------|
| 1 | Цены и сравнение | Вкладка «Цены и сравнение», офферы, «где дешевле» |
| 2 | AI-анализ | Отзывы / полный анализ, вердикт |
| 3 | Отслеживание | Список + история / целевая цена |
| 4 | Telegram-алерты | Настройки Telegram + пример алерта |
| 5 | AI в боте | Карточка @PriceGuardAlertsBot по ссылке |

---

## 6. Иконки

Store icon 128×128 — `public/icons/icon128.png`. Promo 440×280 / marquee — по желанию.

---

## 7. Чеклист публикации

- [ ] Zip `priceguard-ai-v2.20.8.zip`
- [ ] Privacy URL: https://priceguard-landing.vercel.app/privacy
- [ ] Single purpose (§8)
- [ ] Permissions (§9)
- [ ] Data use + Bright Data / Telegram AI в disclosure при необходимости
- [ ] 5 скриншотов + иконка 128
- [ ] Краткое описание ≤132
- [ ] What's New (§2b)
- [ ] Категория Shopping · RU primary, EN optional

---

## 8. Single Purpose Description

**RU:**  
Помогает сравнивать цены, анализировать отзывы с помощью AI и получать уведомления о падении цены на Wildberries, Ozon и Яндекс.Маркет (браузер и Telegram).

**EN:**  
Helps compare prices, analyze reviews with AI, and get price-drop alerts on Wildberries, Ozon, and Yandex Market (browser and Telegram).

---

## 9. Permission Justifications

| Permission | Обоснование |
|------------|-------------|
| `storage` | Список отслеживания, история, настройки, сессия |
| `activeTab` / `tabs` | Цена и отзывы с открытой карточки |
| `windows` | Фоновый поиск Ozon/Я.Маркет (HiddenBrowser) |
| `scripting` | Сбор данных со страниц маркетплейсов |
| `notifications` | Уведомления о падении цены |
| `alarms` | Периодическая проверка и backup-синхронизация |
| `webNavigation` | Смена карточки товара |
| Host: WB / Ozon / YM | Публичные цены и отзывы |
| Host: supabase.co | Синхронизация, AI-прокси, лицензии, Telegram, product-intel |
