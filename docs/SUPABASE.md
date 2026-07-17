# Подключение Supabase — PriceGuard AI (v2.20.8)

## Серверный мониторинг цен (Free + Premium + Telegram)

План уведомлений:
- **Free** — до 5 отслеживаемых товаров, алерты да (сервер при Telegram)
- **Premium** — без лимита, алерты + **приоритет** в cron (`update-prices`)

С подключённым Telegram цены проверяются на сервере **без открытого Chrome** (Free и Premium).  
Если Edge не смог получить цену (часто Ozon/YM antibot), расширение делает **backup** для товаров старше ~8 часов — без ручной кнопки «Обновить».

### 0. Если `db push` падает на `tracked_products_user_mp_product_unique`

В миграции `20260707120000` исправлено: сначала `DROP CONSTRAINT`, потом индекс.  
Обновите код и снова:

```bash
supabase db push
```

### 1. Деплой схемы и функций

```bash
supabase db push
supabase secrets set UPDATE_PRICES_CRON_SECRET=придумайте_длинный_секрет
# TELEGRAM_BOT_TOKEN уже должен быть в secrets

supabase functions deploy update-prices
supabase functions deploy sync-alert-settings
supabase functions deploy tracked-sync
supabase functions deploy telegram-webhook
```

### 2. Cron каждые 6 часов (pg_cron + GitHub Actions)

**A. pg_cron (основной)**

1. Dashboard → **Database** → **Extensions** → включите **pg_cron** и **pg_net** (иногда называется `http`).
2. Откройте файл `supabase/scripts/setup-update-prices-cron.sql`.
3. В SQL Editor подставьте `__SERVICE_ROLE_KEY__` и `__CRON_SECRET__` (не коммитьте ключи).
4. Run → проверьте строку `priceguard-update-prices` в `cron.job`.

**B. GitHub Actions (запасной триггер)**

Файл: `.github/workflows/update-prices.yml`  
Repo secrets: `SUPABASE_URL`, `UPDATE_PRICES_CRON_SECRET`.

Проект PriceGuard: `https://ihlfvpocwobvcpxbypsd.supabase.co`

**Разовая проверка вручную:**

```bash
curl -X POST "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/update-prices" ^
  -H "Authorization: Bearer SERVICE_ROLE_KEY" ^
  -H "x-cron-secret: UPDATE_PRICES_CRON_SECRET" ^
  -H "Content-Type: application/json" ^
  -d "{}"
```

Ожидаемый ответ: `{"ok":true,"stats":{...,"errorsByMarketplace":{...}}}` (если ещё нет пользователей с Telegram — `note: no eligible users`).

### 3. Клиент

1. Войти в «Аккаунт»
2. Настройки → Telegram Вкл + Chat ID (после `/start` боту)
3. Free: до 5 товаров; Premium (ключ/оплата): без лимита + приоритет
4. Товары в «Список» синхронизируются в облако
5. При серверном мониторинге основной путь — cron; клиентский alarm обновляет только **устаревшие** цены (>~8 ч); ручная ↻ в шапке всё ещё работает

Связь с ботом: `update-prices` и `price-alert-notify` шлют через `TELEGRAM_BOT_TOKEN` (@PriceGuardAlertsBot) с кнопкой «Открыть товар».  
`/status` показывает цену, возраст `last_checked` и пометку, если маркетплейс блокирует fetch.

### 4. Bright Data Web Unlocker (серверные secrets)

Для стабильного Ozon / Я.Маркет на сервере (antibot). Ключ **не** вводится в расширении — только в Supabase:

```bash
supabase secrets set BRIGHTDATA_API_KEY=ваш_api_key BRIGHTDATA_ZONE=web_unlocker1
supabase functions deploy update-prices
```

- Zone: тип **Web Unlocker** в аккаунте Bright Data.
- Cron `update-prices` при наличии обоих secrets вызывает Unlocker **до** legacy-парсера (Ozon/YM). WB: сначала `card.wb.ru`, Unlocker только если пусто.
- Кэш `price_scrape_cache` TTL **2 часа**.
- Без secrets — только legacy HTTP + hybrid Chrome backup.
- Ответ cron: `brightdataConfigured` + `stats.bySource: { cache, brightdata, legacy }`.

### Telegram-бот @PriceGuardAlertsBot

**Шаблоны** (HTML + inline-кнопка) — `supabase/functions/_shared/telegram.ts`  
**Отправка** — `price-alert-notify`  
**/start** — `telegram-webhook`

```bash
npx supabase functions deploy price-alert-notify update-prices telegram-webhook

# Привязать webhook (один раз):
# curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
#   -d "url=https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/telegram-webhook"
```

Подробнее: `supabase/scripts/setup-telegram-webhook.md`

Пример алерта о падении:

```
📉 Цена упала!

🛍 Название товара
🏷 Wildberries

💸 Было: 4 990 ₽
✅ Стало: 3 490 ₽
📊 Выгода: −1 500 ₽ (−30.1%)

⭐ PriceGuard AI
[🛒 Открыть товар]  ← inline-кнопка
```

---

## Новое в v2.7

- **Supabase Auth** — синхронизация отслеживаемых товаров по `user_id` (email / Google)
- **Дашборд метрик** — SQL Views + страница `src/admin/index.html`
- **Алерты WB** — `search-alerts` + `chrome.alarms` + опционально Telegram

## Миграции

```bash
supabase db push
```

| Файл | Содержимое |
|------|------------|
| `20260701120000_cache_sync_metrics.sql` | product_cache, tracked_products (legacy), search_metrics, ai_request_log |
| `20260702120000_auth_metrics_views.sql` | **user_id**, views, RLS, notes |

## Edge Functions (деплой)

```bash
supabase secrets set GROK_API_KEY=... OPENAI_API_KEY=...
# Опционально: алерты
supabase secrets set TELEGRAM_BOT_TOKEN=...
supabase secrets set TELEGRAM_CHAT_ID=...
supabase secrets set WB_SUCCESS_RATE_ALERT_THRESHOLD=85
# Админы дашборда (email через запятую)
supabase secrets set METRICS_ADMIN_EMAILS=you@example.com

supabase functions deploy ai-proxy product-cache tracked-sync search-metrics
supabase functions deploy metrics-dashboard search-alerts
```

## Supabase Auth (Dashboard)

1. Authentication → Providers → Email + Google
2. URL Configuration → Redirect URLs:
   - `https://<EXTENSION_ID>.chromiumapp.org/`
   - (узнать ID: `chrome://extensions` → PriceGuard AI)

## Дашборд метрик

- Настройки → «Открыть дашборд метрик»
- Или `chrome.runtime.openOptionsPage()`
- Требуется вход в аккаунт (вкладка «Аккаунт» в popup)

Views: `vw_search_metrics_daily`, `vw_search_metrics_weekly`, `vw_ai_requests`, `vw_wb_success_rate_24h`

## Синхронизация товаров

Войдите во вкладку **Аккаунт** → список отслеживаемых синхронизируется между браузерами через `tracked-sync` + JWT.

Без входа — только локальное хранилище.

## E2E

```bash
npm run test                    # офлайн (WB + Ozon + YM фикстуры)
$env:E2E_LIVE=1; npm run test:e2e   # live все маркетплейсы
```

---

## 1. Создайте проект Supabase

1. [supabase.com](https://supabase.com) → New Project
2. Скопируйте **Project URL** и **anon public key**

## 2. Примените миграции

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Или вставьте SQL в Dashboard → SQL Editor:

| Миграция | Содержимое |
|----------|------------|
| `20260628120000_license_payments.sql` | Лицензии, оплаты |
| `20260628210000_authenticity_events.sql` | События оригинальности |
| `20260701120000_cache_sync_metrics.sql` | **product_cache**, **tracked_products**, **search_metrics**, **ai_request_log** |

### Таблицы (v2.6+)

| Таблица | Назначение |
|---------|------------|
| `product_cache` | Общий кэш отзывов + AI (TTL 7 дней, `cache_version` 1=отзывы, 2=полный анализ) |
| `tracked_products` | Синхронизация отслеживаемых товаров по `device_id` |
| `search_metrics` | Телеметрия поиска (регрессии WB/Ozon/YM) |
| `ai_request_log` | Лог AI-прокси + rate limiting |

RLS включён на всех таблицах **без публичных политик** — доступ только через Edge Functions с `service_role`.

## 3. Secrets и Edge Functions

```bash
# Оплата (если используется)
supabase secrets set YOOKASSA_SHOP_ID=ваш_shop_id
supabase secrets set YOOKASSA_SECRET_KEY=ваш_секрет
supabase secrets set PAYMENT_RETURN_URL=https://ваш-сайт.ru/success

# AI через AITunnel (рекомендуется: один ключ → gpt-4o-mini + grok-3-mini + sonar)
supabase secrets set AITUNNEL_API_KEY=sk-aitunnel-ваш_ключ

# Альтернатива: прямые ключи провайдеров (если AITUNNEL_API_KEY не задан; без Sonar)
supabase secrets set GROK_API_KEY=xai-...
supabase secrets set OPENAI_API_KEY=sk-...

# Опционально: лимиты (по умолчанию 40 запросов / 60 мин на device_id)
# Premium pipeline Sonar→GPT = 2 запроса; при кэше веб-исследования (7 дней) = 1
supabase secrets set AI_RATE_LIMIT_MAX=40
supabase secrets set AI_RATE_LIMIT_WINDOW_MIN=60

# Деплой
supabase functions deploy validate-license
supabase functions deploy create-payment
supabase functions deploy check-payment
supabase functions deploy yookassa-webhook
supabase functions deploy log-authenticity
supabase functions deploy ai-proxy
supabase functions deploy product-cache
supabase functions deploy tracked-sync
supabase functions deploy search-metrics
```

### Edge Functions

| Функция | Описание |
|---------|----------|
| `ai-proxy` | Прокси Grok/OpenAI/Perplexity Sonar, pipeline Sonar→GPT, rate limit, лог в `ai_request_log` (pipeline, web_research_used) |
| `product-cache` | `get`/`put` общего кэша `product_cache` (v1 отзывы, v2 полный анализ, v3 веб-исследование Sonar) |
| `tracked-sync` | `push`/`pull` отслеживаемых товаров по `device_id` |
| `search-metrics` | Запись метрик поиска |

## 4. Настройте расширение

```bash
cp .env.example .env
# VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm run build
```

Перезагрузите расширение в `chrome://extensions`.

## 5. Webhook ЮKassa

- **URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/yookassa-webhook`
- События: `payment.succeeded`, `payment.canceled`

## Демо-ключи (без Supabase)

| Ключ | Что даёт |
|------|----------|
| `PGAI-DEMO-LIFE-2026` | Premium навсегда |
| `PGAI-DEMO-MONTH-2026` | Premium 30 дней |
| `PGAI-TEST-12345-LIFE` | Тест (разработка) |
| `PGAI-BETA-7DAY-TEST` | Premium 7 дней |
| `PGAI-DEMO-MONTH-FREE` | Бета: месяц бесплатно |

## E2E тесты

```bash
# Офлайн-фикстуры (по умолчанию, без сети)
npm run test

# Только E2E (офлайн + live при флаге)
npm run test:e2e

# Live на реальных API маркетплейсов
# PowerShell:
$env:E2E_LIVE=1; npm run test:e2e

# Live + облачный AI (тратит токены, нужен .env)
$env:E2E_LIVE=1; $env:E2E_AI_LIVE=1; npm run test:e2e
```

## Безопасность

- `service_role`, ключи Grok/OpenAI и ЮKassa — **только** в Supabase Secrets
- В расширении только `anon` key
- Клиент не хранит AI-ключи; все запросы идут через `ai-proxy`
