# Supabase Auth — PriceGuard AI (v2.20.8)

Полная настройка авторизации, миграции `device_id → user_id` и синхронизации отслеживаемых товаров.

## Что уже реализовано в расширении

| Компонент | Путь |
|-----------|------|
| Auth (email + Google OAuth) | `src/lib/supabase/auth.ts` |
| Проверки авторизации | `src/lib/supabase/auth-guard.ts` |
| Миграция при входе | `src/lib/supabase/post-login.ts` |
| Claim legacy device_id | `src/lib/supabase/claim-device.ts` + edge `claim-device-tracked` |
| Синхронизация | `src/lib/supabase/tracked-sync.ts` + edge `tracked-sync` |
| UI входа | `src/popup/components/AuthTab.tsx` (вкладка «Аккаунт») |
| Realtime | `src/lib/supabase/tracked-realtime.ts` |

---

## Что нужно сделать вам (пошагово)

### 1. Создать проект Supabase

1. [supabase.com](https://supabase.com) → **New Project**
2. Скопируйте **Project URL** и **anon public key** (Settings → API)

### 2. Применить SQL-миграции

```bash
cd priceguard-ai
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Миграции (по порядку):

| Файл | Назначение |
|------|------------|
| `20260628120000_license_payments.sql` | Лицензии, оплаты |
| `20260628210000_authenticity_events.sql` | События оригинальности |
| `20260701120000_cache_sync_metrics.sql` | Кэш, tracked_products (legacy device_id), метрики |
| `20260702120000_auth_metrics_views.sql` | user_id, views, RLS (**TRUNCATE** legacy — только на чистой миграции) |
| `20260703120000_device_claim_realtime.sql` | RPC claim + Realtime |
| `20260707120000_auth_setup_complete.sql` | **Безопасная** финальная настройка Auth + RLS |

> Если БД уже в проде с данными — используйте `20260707120000` вместо повторного `20260702120000` (он делает TRUNCATE).

### 3. Настроить Auth в Dashboard

**Authentication → Providers:**
- ✅ Email (**Confirm email = OFF** — регистрация сразу с сессией; без своего SMTP письма confirm/reset на Яндекс/Mail.ru часто не доходят)
- Google — опционально, для РФ обычно не нужен

**Authentication → URL Configuration → Redirect URLs:**

```
https://<EXTENSION_ID>.chromiumapp.org/
```

Узнать ID: `chrome://extensions` → PriceGuard AI → ID расширения.

В popup: вкладка **Аккаунт** → «Настройка Supabase» показывает точный URL.

### Google OAuth для Chrome Extension (рекомендуется)

1. **Google Cloud Console** → Credentials → OAuth client **Web application**
2. **Authorized redirect URIs** — добавьте (без завершающего слэша):
   ```
   https://<EXTENSION_ID>.chromiumapp.org
   ```
3. Скопируйте Client ID в `.env` (только ID, без Client Secret):
   ```
   VITE_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   ```
4. **Supabase** → Authentication → Google:
   - **Client IDs** — тот же Client ID (без `VITE_=...`)
   - **Client Secret** — только в Dashboard (не в `.env` расширения)
   - Callback URL `https://<project>.supabase.co/auth/v1/callback` — для web/PKCE; для расширения нужен `https://<EXTENSION_ID>.chromiumapp.org`
5. Включите **Skip nonce checks** для Google provider
6. **Supabase Redirect URLs** — добавьте `https://<EXTENSION_ID>.chromiumapp.org/`

Расширение использует `chrome.identity.getRedirectURL()` + `signInWithIdToken` (см. `src/lib/supabase/auth.ts`).

### 4. Задеплоить Edge Functions

```bash
supabase secrets set GROK_API_KEY=... OPENAI_API_KEY=...

supabase functions deploy tracked-sync
supabase functions deploy claim-device-tracked
supabase functions deploy ai-proxy product-cache search-metrics
supabase functions deploy metrics-dashboard search-alerts
```

Опционально:

```bash
supabase secrets set METRICS_ADMIN_EMAILS=you@example.com
```

### 5. Настроить расширение

```bash
cp .env.example .env
# VITE_SUPABASE_URL=https://xxx.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...
npm run package:zip
```

Перезагрузите расширение в `chrome://extensions`.

---

## Миграция данных device_id → user_id

### Сценарий A: Legacy-записи в облаке (старая версия с device_id)

```
tracked_products: device_id = "abc-123", user_id = NULL
         ↓ первый вход (JWT)
claim-device-tracked(deviceId) → RPC claim_tracked_products_by_device
         ↓
tracked_products: user_id = <auth.uid>, device_id = NULL
```

### Сценарий B: Только локальные товары (chrome.storage)

```
chrome.storage.local.trackedProducts[]
         ↓ первый вход
syncTrackedProductsWithCloud() → tracked-sync push (JWT, user_id)
         ↓
Облако + другие устройства получают список
```

### Сценарий C: Оба источника

1. `claim-device-tracked` — перенос legacy из облака
2. `syncTrackedProductsWithCloud` — merge локальных + pull с сервера

Claim выполняется **один раз на user_id** (ключ `priceguard_claim_done_<userId>` в chrome.storage).

---

## RLS (tracked_products)

```sql
-- Пользователь видит только свои записи
CREATE POLICY tracked_products_select_own ON tracked_products
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE — аналогично auth.uid() = user_id
```

Клиент **не пишет напрямую** в таблицу — только через Edge Functions с `service_role`. RLS нужен для **Realtime** (postgres_changes).

Legacy-строки (`device_id`, `user_id IS NULL`) доступны только через RPC `claim_tracked_products_by_device` (service_role).

---

## Проверка авторизации в коде

| Функция | Поведение без входа |
|---------|---------------------|
| `syncTrackedProductsWithCloud()` | skip (локально только) |
| `pushTrackedProduct()` | skip |
| `tracked-sync` edge | 401 |
| `claim-device-tracked` edge | 401 |
| `ai-proxy` | работает по device_id (anon) |
| `metrics-dashboard` | 401 |

---

## Проверка после настройки

1. Войти через Google или email на вкладке **Аккаунт**
2. Добавить товар в отслеживаемые
3. На втором браузере войти тем же аккаунтом → товар появится
4. Supabase → Table Editor → `tracked_products` → строки с вашим `user_id`

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| OAuth «redirect mismatch» | Добавьте `chrome.identity.getRedirectURL()` в Supabase Redirect URLs |
| Синхронизация не работает | Проверьте `.env`, деплой `tracked-sync`, вход в аккаунт |
| Claim не переносит данные | Убедитесь, что legacy-строки имеют `device_id` и `user_id IS NULL` |
| 401 на edge | JWT истёк — перелогиньтесь; проверьте anon key |
