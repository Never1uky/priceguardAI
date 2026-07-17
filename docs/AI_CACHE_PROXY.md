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

**TTL:** 7 дней — проверяется на клиенте (`PRODUCT_CACHE_TTL_MS`) и на сервере в `product-cache` Edge Function.

Связанная таблица `ai_request_log` — rate limiting и телеметрия для `ai-proxy`.

---

## 2. Edge Function `ai-proxy`

Путь: `supabase/functions/ai-proxy/index.ts`

**Секреты (Supabase Dashboard → Secrets):**
```bash
supabase secrets set GROK_API_KEY=xai-... OPENAI_API_KEY=sk-...
# опционально:
supabase secrets set AI_RATE_LIMIT_MAX=40 AI_RATE_LIMIT_WINDOW_MIN=60
```

**Деплой:**
```bash
supabase functions deploy ai-proxy product-cache
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

## 6. Переменные окружения

**Сборка расширения (`.env`):**
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Supabase Secrets (сервер):**
```
GROK_API_KEY
OPENAI_API_KEY
```

**Не нужно в расширении:** `GROK_API_KEY`, `OPENAI_API_KEY`.

---

## 7. Тестирование

```bash
# Юнит-тесты
npm run test

# Живой ai-proxy (тратит токены)
node scripts/test-ai-proxy.mjs grok "Привет"

# E2E с AI
E2E_AI_LIVE=1 npm run test
```
