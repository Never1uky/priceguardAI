# AI-кэш и серверный прокси (PriceGuard AI)

Архитектура: **ключи Grok/OpenAI только на сервере**, расширение ходит в `ai-proxy`, результаты кэшируются в Supabase `product_cache` (TTL 7 дней).

## 1. SQL — таблица `product_cache`

Миграция: `supabase/migrations/20260701120000_cache_sync_metrics.sql`

```sql
create table if not exists public.product_cache (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,              -- артикул / nmId / offer id
  product_title text,
  model text,                            -- grok-3-mini / gpt-4o-mini
  raw_reviews jsonb,                     -- string[] текстов отзывов
  ai_analysis jsonb,                     -- ReviewAnalysisResult | FullProductAnalysis
  last_updated timestamptz not null default now(),
  cache_version integer not null default 1,
  unique (marketplace, product_id, cache_version)
);

create index if not exists product_cache_lookup_idx
  on public.product_cache (marketplace, product_id, cache_version);

create index if not exists product_cache_last_updated_idx
  on public.product_cache (last_updated desc);

alter table public.product_cache enable row level security;
-- Прямой доступ клиенту закрыт; только Edge Function product-cache (service_role).
```

**Версии кэша:**
| `cache_version` | Содержимое `ai_analysis` |
|-----------------|--------------------------|
| `1` | Анализ отзывов (`ReviewAnalysisResult`) |
| `2` | Полный анализ товара (`FullProductAnalysis`) |
| `3` | Web research (SERP / compare) |

**TTL:** 7 дней — проверяется на клиенте (`PRODUCT_CACHE_TTL_MS`) и на сервере в `product-cache` Edge Function.

Связанная таблица `ai_request_log` — rate limiting и телеметрия для `ai-proxy`.
Таблица `edge_request_log` — общий rate limit для других Edge (например `reviews-fetch`).

**Единая запись:** `_shared/product-cache-store.ts` (`getFresh` / `upsertVersioned` / `invalidateProductCacheAnalysis`) — используют `product-cache`, `ai-proxy`, `product-intel`. Upsert v2 и v3 одного SKU не затирают друг друга (unique на `marketplace, product_id, cache_version`).

**Инвалидация при скачке цены:** `update-prices` при Δ ≥ **10%** или ≥ **500 ₽** ставит `last_updated` в прошлое для `cache_version IN (1, 2)` того же `(marketplace, product_id)` — следующий get видит miss/expired. Клиент уже инвалидирует local full-analysis по тем же порогам.

---

## 2. Edge Function `ai-proxy`

Путь: `supabase/functions/ai-proxy/index.ts`

**Секреты (Supabase Dashboard → Secrets):**
```bash
supabase secrets set GROK_API_KEY=xai-... OPENAI_API_KEY=sk-...
# опционально:
supabase secrets set AI_RATE_LIMIT_MAX=40 AI_RATE_LIMIT_WINDOW_MIN=60
```

**Деплой (AI + hardening):**
```bash
supabase functions deploy ai-proxy product-cache product-intel reviews-fetch \
  cross-market-map match-feedback compare-research update-prices
```

**Запрос от расширения:**
```json
POST /functions/v1/ai-proxy
{
  "provider": "grok",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.2,
  "max_tokens": 4096,
  "jsonMode": true,
  "deviceId": "uuid-устройства"
}
```

**Ответ:**
```json
{ "ok": true, "text": "...", "provider": "grok", "model": "grok-3-mini" }
```

**Поведение:**
- Ключи читаются из `GROK_API_KEY` / `OPENAI_API_KEY`
- Fallback: если Grok недоступен → OpenAI (и наоборот)
- Rate limit по `user_id` (JWT) или `device_id` — таблица `ai_request_log`
- Логирование каждого запроса (успех/ошибка, токены, duration)

---

## 3. Edge Function `product-cache`

Путь: `supabase/functions/product-cache/index.ts`

**Действия:**

| action | body | ответ |
|--------|------|-------|
| `get` | `{ marketplace, productId, cacheVersion? }` | `{ ok, entry \| null, expired? }` |
| `put` | `{ marketplace, productId, productTitle?, model?, rawReviews?, aiAnalysis?, cacheVersion? }` | `{ ok }` |

При `get` записи старше 7 дней возвращается `entry: null, expired: true`.

---

## 4. Изменения в расширении

### Клиент AI (`src/api/ai.ts`)

```typescript
// Все запросы — только через прокси
const data = await callEdge('ai-proxy', {
  provider,
  messages: [...],
  temperature: 0.2,
  jsonMode: true,
  deviceId,
});
```

- В `chrome.storage.local` хранится **только приоритет** провайдера (`priceguard_ai_priority`)
- Ключи **не** хранятся и **не** передаются с клиента
- `hasAnyApiKey()` = настроен ли Supabase в сборке (`VITE_SUPABASE_URL` + anon key)

### Кэш (`src/lib/supabase/product-cache.ts`)

```typescript
import { getRemoteProductCache, putRemoteProductCache } from '@/lib/supabase/product-cache';

// Чтение
const remote = await getRemoteProductCache('wildberries', '12345678');
if (remote?.fresh && remote.aiAnalysis) { /* использовать */ }

// Запись после AI
await putRemoteProductCache({
  marketplace: 'wildberries',
  productId: '12345678',
  productTitle: '...',
  model: 'Grok 3 Mini',
  rawReviews: reviews,
  aiAnalysis: result,
});
```

### Поток в background (`src/background/index.ts`)

**ANALYZE_REVIEWS:**
1. Собрать отзывы
2. Локальный кэш (`priceguard_review_cache`)
3. Удалённый кэш Supabase (`cache_version=1`)
4. Freemium: `canMakeAiRequest()` — 5 запросов/сутки для free
5. `sendToAIWithFallback` → `ai-proxy`
6. `recordAiRequest()` + `putRemoteProductCache`

**FULL_PRODUCT_ANALYSIS:**
1. Локальный + удалённый кэш (`cache_version=2`)
2. **Только Premium** для нового AI-запроса
3. Premium: безлимит облачных запросов

### Freemium (`src/lib/api/ai-quota.ts`)

| | Free | Premium |
|---|------|---------|
| Анализ отзывов (облако) | 5 / 24 ч | ∞ |
| Полный анализ | ❌ (только кэш) | ✅ |
| Счётчик | `priceguard_ai_daily_quota` | не ведётся |
| Кэш Supabase | ✅ без списания квоты | ✅ |

---

## 5. Как работает кэш

```
Пользователь нажимает «Анализ отзывов»
        │
        ▼
┌─────────────────────┐
│ Локальный кэш       │  chrome.storage: priceguard_review_cache
│ (6 ч – 7 дней)      │  ключ: mp:wildberries:12345678
└─────────┬───────────┘
          │ miss
          ▼
┌─────────────────────┐
│ Supabase product_cache │  marketplace + product_id + cache_version=1
│ TTL 7 дней          │  общий для всех пользователей
└─────────┬───────────┘
          │ miss / expired
          ▼
┌─────────────────────┐
│ Freemium quota?     │  free: ≤5/день
└─────────┬───────────┘
          │ ok
          ▼
┌─────────────────────┐
│ ai-proxy            │  Grok/GPT на сервере
└─────────┬───────────┘
          │
          ▼
  save local + putRemoteProductCache
```

**Ключ кэша:** `marketplace` + `product_id` (артикул/nmId). Для WB/Ozon/YM артикул предпочтительнее URL.

**Экономия токенов:** если любой пользователь уже проанализировал товар за последние 7 дней, остальные получают готовый результат без вызова AI.

---

## 6. Edge hardening (rate limits, mapping, compare verify)

### `reviews-fetch` — internal-only + rate limit

Публичный JWT-доступ **закрыт** (в расширении callers нет). Нужен `x-cron-secret` (= `UPDATE_PRICES_CRON_SECRET`) или Bearer service_role.

Опционально снова открыть для JWT: secret `ALLOW_REVIEWS_FETCH_JWT=1`. При JWT — лимит через `edge_request_log` (по умолчанию ~20/час/user).

**BREAKING** только для внешних JWT-caller’ов; расширение не затронуто.

### `cross-market-map` — moderation cooldown + `unverified`

- `dispute` / `reportFail`: не чаще **1× / 24ч / user / (edge, action)**; повтор → `429` `{ code: 'moderation_cooldown' }` (таблица `mapping_moderation_events`).
- Manual upsert с `matchConfidence < 70` → `status: 'unverified'`.
- `lookup`: primary только `active`; `unverified` — в `unverifiedAlternates` с флагом `unverified: true` (additive).

### `match-feedback` + crowd promote

Пишет `user_id`, optional `source_title` / `candidate_title`. Promote (`maybePromoteMultiUserMapping`): ≥2 distinct users, avg confidence ≥70, title score ≥70 если titles есть, блок при reject/dispute за 7 дней; audit в `mapping_promotion_audit`.

### `compare-research` — top-1 server verify

Для top-1 каждой target MP (не всех 5): card/Scrappey через `fetchMarketplacePriceDetailed` (+ `price_scrape_cache`). Additive на кандидате: `serverVerified`, `serverMatchConfidence`, `serverTitle`. Без Scrappey — Ozon/YM skip (`serverVerified: false`); WB может проверить через card API.

Миграция: `supabase/migrations/20260723120000_edge_hardening_p0_p1.sql`.

---

## 7. Переменные окружения

**Сборка расширения (`.env`):**
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Supabase Secrets (сервер):**
```
GROK_API_KEY
OPENAI_API_KEY
UPDATE_PRICES_CRON_SECRET   # reviews-fetch gate + cron
SCRAPPEY_API_KEY             # compare-research / price fetch
# optional:
ALLOW_REVIEWS_FETCH_JWT=1
AI_RATE_LIMIT_MAX=40
AI_RATE_LIMIT_WINDOW_MIN=60
```

**Не нужно в расширении:** `GROK_API_KEY`, `OPENAI_API_KEY`, Scrappey keys.

---

## 8. Тестирование

```bash
# Юнит-тесты
npm run test

# Живой ai-proxy (тратит токены)
node scripts/test-ai-proxy.mjs grok "Привет"

# E2E с AI
E2E_AI_LIVE=1 npm run test
```
