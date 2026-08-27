# Материалы для Chrome Web Store — PriceGuard AI

Версия расширения: **0.9.90 (Early access)**  
Категория: **Shopping**  
Язык листинга: **Русский** (основной), **English** (дополнительно)

Privacy Policy (публичный URL): https://priceguard-landing.vercel.app/privacy  
Контакт: priceguardAlsupp0rt@yandex.ru · Telegram поддержки: @priceguard_supportbot

---

## 0. Что сделать вручную перед загрузкой (чеклист оператора)

1. **Privacy URL** — `https://priceguard-landing.vercel.app/privacy` (или GitHub Pages `docs/privacy/`). Policy **v2.4**.
2. **Confirm email OFF** в Supabase Dashboard (Auth → Email), либо SMTP.
3. **5 скриншотов 1280×800** — из `docs/store-assets/` (или live-capture с теми же сюжетами).
4. **Smoke P0** на zip без debug: WB/Ozon/YM сравнение; вход; Premium restore; Telegram «Подключить»; AI; SW без `import() is disallowed`. См. `docs/RELEASE_GO.md`.
5. **ЮKassa smoke** — `docs/YOOKASSA_SMOKE.md` (один успешный тестовый платёж).
6. Загрузить **только** `priceguard-ai-v0.9.90.zip`. Visibility: **Unlisted** → Submit for review. **Не Public** до апрува.
7. Prod secrets: `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_SUPPORT_WEBHOOK_SECRET`, `METRICS_ADMIN_EMAILS`, AI/YooKassa/Scrappey; deploy Edge JWT hardenings.
8. В форме CWS: Single purpose (§8), Permissions (§9), Data use: product URLs, prices, reviews (incl. raw sample for AI), match feedback / compare-research, email (optional), device_id, Telegram chat id + AI questions (optional), price history / comparison data, **automatic support error reports** (truncated error text ≤800 chars, optional context, extension version, userId — via Supabase Edge `support-notify` → operator Telegram); processors: Supabase, Grok/OpenAI/Perplexity, Scrappey (server scrape), YooKassa, Telegram.
9. (Опц. перед Public) `docs/sql/disable-demo-license-keys.sql` в SQL Editor.
---

## 1. Короткое описание (до 132 символов)

### Русский (рекомендуется)

```
AI-анализ отзывов, сравнение цен на маркетплейсах и алерты в Telegram — даже без открытого Chrome.
```
*(109 символов)*

### Русский — альтернатива

```
Цены, скидки и AI-отзывы на популярных маркетплейсах. Сравнение и уведомления о падении цены (по умолчанию WB, Ozon, Я.Маркет; другие — по выбору).
```
*(105 символов)*

### English

```
AI review insights, cross-store prices & Telegram alerts — even without Chrome open.
```
*(109 characters)*

---

## 2. Полное описание (до 4000 символов)

### Русский

```
PriceGuard AI — умный помощник для покупок на популярных маркетплейсах и интернет-магазинах.

Сравнивайте цены между площадками, читайте AI-разбор отзывов и получайте алерты о падении цены в браузере и в Telegram — в том числе когда Chrome закрыт (серверный мониторинг).

🛒 ДЛЯ КОГО
• Покупатели на маркетплейсах (WB, Ozon, Я.Маркет и др. по выбору)
• Те, кто ищет, где дешевле, без ручного копирования ссылок
• Те, кто ждёт скидку и не хочет переплачивать
• Те, кому нужен короткий вердикт по отзывам вместо сотен комментариев

✨ ВОЗМОЖНОСТИ

🤖 AI-анализ отзывов и полный разбор товара
Плюсы, минусы, риск накрутки/подделки, вердикт «покупать / подождать». Free: до 3 AI-анализов в сутки (после входа). Premium — без лимита AI + глубокий разбор с веб-контекстом.

⚖️ Сравнение на трёх площадках
Один товар — таблица офферов по выбранным площадкам (по умолчанию WB / Ozon / Яндекс.Маркет). Сразу видно, где дешевле, переход в карточку в один клик.

📉 Отслеживание и история цен
Список «Отслеживаемое», целевая цена, график истории. Понятно, реальная ли скидка.

🔔 Алерты в браузере и Telegram
Подключите @PriceGuardAlertsBot: уведомления о падении цены и AI-карточка по ссылке на товар (кнопки: недостатки, где дешевле, история…). Поддержка — @priceguard_supportbot.

☁️ Без открытого Chrome
При включённом Telegram сервер проверяет цены по расписанию (Free — до 5 товаров; Premium — до 50 и с приоритетом).

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
PriceGuard AI — a smart shopping assistant for popular marketplaces and online stores.

Compare prices across stores, get AI review insights, and receive price-drop alerts in the browser and Telegram — including when Chrome is closed (server monitoring).

🛒 WHO IT'S FOR
• Shoppers on WB, Ozon, Yandex Market and optional extra stores
• Anyone looking for where it’s cheaper without copying links by hand
• Deal hunters waiting for a real discount
• Busy buyers who want a short review verdict

✨ FEATURES

🤖 AI review analysis & full product breakdown
Pros, cons, fake/manipulation risk, buy/wait verdict. Free: up to 3 full AI analyses per day (after sign-in). Premium: unlimited.

⚖️ Cross-marketplace compare
One product — offers from your selected stores (default WB / Ozon / Yandex Market) in one table. See where it’s cheaper and open the listing in one click.

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

🛍️ STORES: Wildberries · Ozon · Yandex Market (default) · optional Megamarket, AliExpress, M.Video/Eldorado, DNS, Citilink, Lamoda

Not affiliated with the marketplaces. Public page data at request time.

Install PriceGuard AI — shop smarter.
```

---

## 2b. What's New (поле «Что нового» для 0.9.95)

### Русский

```
• Настройки → Telegram: исправлена вёрстка блока (статус и текст не наслаиваются)
• «Где дешевле»: безопаснее выбор похожих товаров — порядок, названия, без ложного «дешевле»
• Wildberries без цены: «Нет в наличии» вместо пустого экрана
• Карточка: рейтинг и цвет; лимит 5 товаров и Premium — понятнее
• Стабильнее сравнение и отслеживание после перезапуска расширения
```

### English

```
• Settings → Telegram: fixed section layout (status badge no longer overlaps text)
• Compare prices: safer similar-product picker — order, titles, no false “cheaper” match
• Wildberries out-of-stock: clear “Not in stock” instead of empty screen
• Product card: rating and color; clearer 5-item limit and Premium UX
• More reliable compare and tracking after extension restart
```

---

## 2b (archive). What's New для 0.9.90 Early access

### Русский

```
• Early access: возможны неточности матчинга — пишите в поддержку
• Telegram-бот алертов: статус товаров, AI и FAQ
• Статус «Нет в наличии» и надёжнее сравнение цен
• Отчёт для поддержки при сбое (без промптов и паролей)
• Облачный AI и алерты без постоянно открытого Chrome
```

### English

```
• Early access: matching may be imperfect — contact support
• Telegram alerts bot: product status, AI, and FAQ
• Out-of-stock status and more reliable price compare
• Support diagnostics export on failure (no prompts/passwords)
• Cloud AI and alerts without keeping Chrome open
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
7. **Freemium** — 3 AI/день и до 5 товаров бесплатно; Premium — до 50 товаров.
8. **Синхронизация** — список и Telegram после входа в аккаунт.

---

## 5. Структура скриншотов (5 × 1280×800, опционально 7)

| # | Файл | Заголовок | Что показать |
|---|------|-----------|--------------|
| 1 | `01-compare.png` | Где дешевле — сразу | Вкладка «Цены», таблица WB/Ozon/YM, метка «Где дешевле» |
| 2 | `02-ai-reviews.png` | AI-анализ отзывов | Вкладка «Отзывы», вердикт, плюсы/минусы |
| 3 | `03-tracking.png` | Мои товары | Цена, скидка, вкладки «Цены» / «Мои товары» |
| 4 | `04-price-history.png` | Скидка и история | Процент скидки, подсказка проверить историю |
| 5 | `05-full-analysis.png` | Полный AI-разбор | Альтернативы, характеристики, «Рекомендую купить» |
| 6 | `06-telegram-ai.png` | Telegram без Chrome | Настройки бота @PriceGuardAlertsBot (опционально) |
| 7 | `07-telegram-alert.png` | Алерты в Telegram | «Цена упала» / «Нашли дешевле» (опционально) |

Пересборка: `Desktop\screenshots for CWS\photopea-mockup\build-mockups.ps1` → копия в `docs/store-assets/`.

---

## 6. Иконки

Store icon 128×128 — `docs/store-assets/icons/store-icon-128.png` (или `public/icons/icon128.png`; hex price-tag + P, `npm run icons`). Small promo 440×280 — `docs/store-assets/icons/small-promo-440x280.png`. Marquee — по желанию.

**Скриншоты:** `docs/store-assets/` — 5×1280×800 (готовы к загрузке; перед Public желательно заменить на live-capture).

---

## 7. Чеклист публикации

- [ ] Zip `priceguard-ai-v0.9.0.zip`
- [ ] Privacy URL: https://priceguard-landing.vercel.app/privacy
- [ ] Single purpose (§8)
- [ ] Permissions (§9)
- [ ] Data use + Scrappey / Telegram AI в disclosure при необходимости
- [ ] 5 скриншотов + иконка 128
- [ ] Краткое описание ≤132
- [ ] What's New (§2b)
- [ ] Категория Shopping · RU primary, EN optional

---

## 8. Single Purpose Description

**RU:**  
Помогает сравнивать цены на популярных маркетплейсах и интернет-магазинах, анализировать отзывы с помощью AI и получать уведомления о падении цены (браузер и Telegram). По умолчанию — Wildberries, Ozon и Яндекс.Маркет; дополнительные площадки включаются в настройках.

**EN:**  
Helps compare prices on popular marketplaces and online stores, analyze reviews with AI, and get price-drop alerts (browser and Telegram). Defaults: Wildberries, Ozon, and Yandex Market; extra stores are opt-in in settings.

---

## 9. Permission Justifications

Копируйте в Chrome Web Store Developer Dashboard (каждое разрешение отдельно).

| Permission | Обоснование (RU для формы) |
|------------|----------------------------|
| `storage` | Хранение списка отслеживания, истории цен, настроек алертов/темы, сессии Supabase Auth и локального кэша AI-анализа. Без синхронизации через `storage.sync` для секретов. |
| `scripting` | Внедрение content script и вспомогательных скриптов на страницах поддерживаемых магазинов для чтения публичных данных карточки/SERP (цена, название, отзывы) и ensureContentScript при HiddenBrowser scrape. Не загружаем удалённый код. |
| `notifications` | Браузерные уведомления о падении цены и достижении целевой цены. |
| `alarms` | Периодическая проверка цен (раз в ~6 ч), flush PendingSync и фоновые задачи при закрытом popup. |
| `webNavigation` | Отслеживание SPA-навигации на маркетплейсах (`onCompleted` / `onHistoryStateUpdated`): переход между карточками без полной перезагрузки страницы, чтобы обновить scraped product. |
| Host: `wildberries.ru` / `www.wildberries.ru` | Content script + fetch публичных страниц каталога/карточки. |
| Host: `card.wb.ru`, `search.wb.ru`, `feedbacks1/2.wb.ru` | Только **fetch из service worker** (цена, поиск, отзывы WB API) — **не** content_scripts. |
| Host: `*.wbbasket.ru` | CDN изображений товаров WB в UI сравнения. |
| Host: `ozon.ru` / `www.ozon.ru` | Content script на product/search + scrape/SERP. |
| Host: `market.yandex.ru` | Content script на product/search/card + scrape. |
| Host: `megamarket.ru` / `sbermegamarket.ru` | Opt-in сравнение: content script / HiddenBrowser на публичных catalog/details (без серверного Scrappey). |
| Host: `aliexpress.ru` / `*.aliexpress.ru` | Opt-in сравнение: публичные item/wholesale страницы. |
| Host: `mvideo.ru` / `eldorado.ru` | Opt-in сравнение (единый id М.Видео): публичные product/search страницы. |
| Host: `dns-shop.ru` | Opt-in сравнение: публичные product/search. |
| Host: `citilink.ru` | Opt-in сравнение: публичные product/search. |
| Host: `lamoda.ru` | Opt-in сравнение (в основном fashion): публичные `/p/` и catalogsearch. |
| Host: `ihlfvpocwobvcpxbypsd.supabase.co` | Edge Functions: AI-прокси, sync, лицензии, Telegram settings, product-intel. |
| `externally_connectable` → `priceguard-seo.vercel.app` | Мост SEO-сайта → расширение («Открыть в сравнении»). Localhost **не** входит в production zip. |

**Data use:** расширение передаёт данные о просматриваемых/отслеживаемых товарах (URL, цены, выборка отзывов, match feedback) на наш бэкенд Supabase для AI-анализа, синхронизации и алертов. При неожиданных ошибках может уйти автоматический отчёт: текст ошибки (≤800), контекст, версия, userId (`support-notify` → Telegram оператора). **Мы не продаём персональные данные третьим лицам.** Процессоры: Supabase, AI (Grok/OpenAI/Perplexity), Scrappey (URL страницы), YooKassa, Telegram — только для работы сервиса.

**Privacy Policy URL:** https://priceguard-landing.vercel.app/privacy

Не запрашиваем: `activeTab`, `tabs`, `windows`, `cookies`, `identity`, `api.ozon.ru`. URL вкладок маркетплейсов доступны через `host_permissions`; `chrome.windows` / `chrome.tabs.create` не требуют отдельных permissions.

**BYOK / Premium (для ревьюеров):** ключи AI не хранятся в расширении (только приоритет провайдера в `chrome.storage.local`). Premium UI читает локальный флаг; активация и costly server paths проверяются на Edge (`validate-license` / `user_premium` / JWT).
