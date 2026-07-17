-- PriceGuard AI — кэш, синхронизация и метрики
-- Все таблицы закрыты RLS без публичных политик:
-- доступ только через Edge Functions с service_role (см. supabase/functions/*).
-- Это гарантирует, что клиент (anon) не может читать/писать чужие данные напрямую,
-- а изоляция «по device_id» выполняется внутри функций.

-- ============================================================================
-- 1. product_cache — общий кэш отзывов и AI-анализа между устройствами
-- ============================================================================
create table if not exists public.product_cache (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,
  product_title text,
  model text,                       -- модель AI, которой был сделан анализ (grok-3-mini / gpt-4o-mini)
  raw_reviews jsonb,                -- собранные тексты отзывов (для повторного анализа без скрапинга)
  ai_analysis jsonb,               -- результат AI-анализа (ReviewAnalysisResult / FullProductAnalysis)
  last_updated timestamptz not null default now(),
  cache_version integer not null default 1,
  -- одна актуальная запись на (маркетплейс, товар, версия схемы кэша)
  unique (marketplace, product_id, cache_version)
);

create index if not exists product_cache_lookup_idx
  on public.product_cache (marketplace, product_id, cache_version);

create index if not exists product_cache_last_updated_idx
  on public.product_cache (last_updated desc);

alter table public.product_cache enable row level security;

-- ============================================================================
-- 2. tracked_products — синхронизация отслеживаемых товаров между устройствами
-- ============================================================================
create table if not exists public.tracked_products (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,          -- анонимный идентификатор устройства (или user_id при авторизации)
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,
  product_title text,
  target_price numeric,
  last_price numeric,
  last_checked timestamptz,
  deleted boolean not null default false,   -- tombstone для двусторонней синхронизации удалений
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, marketplace, product_id)
);

create index if not exists tracked_products_device_idx
  on public.tracked_products (device_id, updated_at desc);

alter table public.tracked_products enable row level security;

-- ============================================================================
-- 3. search_metrics — телеметрия поиска (мониторинг регрессов)
-- ============================================================================
create table if not exists public.search_metrics (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  search_query text,
  success boolean not null default false,
  response_time_ms integer,
  found_product_id text,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists search_metrics_created_at_idx
  on public.search_metrics (created_at desc);

create index if not exists search_metrics_marketplace_idx
  on public.search_metrics (marketplace, success, created_at desc);

alter table public.search_metrics enable row level security;

-- ============================================================================
-- 4. ai_request_log — лог запросов к AI-прокси + основа для rate limiting
-- ============================================================================
create table if not exists public.ai_request_log (
  id uuid primary key default gen_random_uuid(),
  device_id text,
  provider text not null check (provider in ('grok', 'openai')),
  model text,
  success boolean not null default false,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- по этому индексу считаем количество запросов устройства за окно rate limit
create index if not exists ai_request_log_device_time_idx
  on public.ai_request_log (device_id, created_at desc);

alter table public.ai_request_log enable row level security;
