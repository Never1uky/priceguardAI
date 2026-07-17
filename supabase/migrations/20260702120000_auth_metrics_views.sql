-- PriceGuard AI v2.7 — Supabase Auth, метрики (views), RLS для tracked_products
--
-- Изменения:
--   1. tracked_products: device_id → user_id (auth.users), поле notes
--   2. search_metrics / ai_request_log: user_id для привязки к аккаунту
--   3. SQL Views для дашборда метрик
--   4. RLS: пользователь видит только свои tracked_products

-- ============================================================================
-- 1. tracked_products — переход на user_id
-- ============================================================================

-- Новые колонки
alter table public.tracked_products
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.tracked_products
  add column if not exists notes text;

-- Удаляем старую привязку к device_id (данные без user_id не мигрируются автоматически)
alter table public.tracked_products drop constraint if exists tracked_products_device_id_marketplace_product_id_key;

drop index if exists tracked_products_device_idx;

alter table public.tracked_products drop column if exists device_id;

-- Legacy-записи без user_id не мигрируются — очищаем перед NOT NULL
truncate table public.tracked_products;

-- Уникальность: один товар на пользователя и маркетплейс
alter table public.tracked_products
  add constraint tracked_products_user_mp_product_unique
  unique (user_id, marketplace, product_id);

create index if not exists tracked_products_user_updated_idx
  on public.tracked_products (user_id, updated_at desc);

-- user_id обязателен для новых записей
alter table public.tracked_products
  alter column user_id set not null;

-- ============================================================================
-- 2. search_metrics — user_id (опционально для анонимной телеметрии)
-- ============================================================================

alter table public.search_metrics
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists search_metrics_user_idx
  on public.search_metrics (user_id, created_at desc);

-- device_id оставляем nullable для обратной совместимости edge function
alter table public.search_metrics
  alter column device_id drop not null;

-- ============================================================================
-- 3. ai_request_log — user_id + токены
-- ============================================================================

alter table public.ai_request_log
  add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.ai_request_log
  add column if not exists prompt_tokens integer;

alter table public.ai_request_log
  add column if not exists completion_tokens integer;

create index if not exists ai_request_log_user_time_idx
  on public.ai_request_log (user_id, created_at desc);

alter table public.ai_request_log
  alter column device_id drop not null;

-- ============================================================================
-- 4. SQL Views — дашборд метрик
-- ============================================================================

-- Дневная статистика поиска за 30 дней
create or replace view public.vw_search_metrics_daily
with (security_invoker = false) as
select
  marketplace,
  date_trunc('day', created_at at time zone 'UTC')::date as day,
  count(*)::bigint as total_requests,
  count(*) filter (where success)::bigint as successful_requests,
  count(*) filter (where not success)::bigint as failed_requests,
  round(
    100.0 * count(*) filter (where success) / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  round(avg(response_time_ms)::numeric, 0) as avg_response_time_ms
from public.search_metrics
where created_at >= now() - interval '30 days'
group by marketplace, date_trunc('day', created_at at time zone 'UTC')::date
order by day desc, marketplace;

-- Недельная статистика (последние 7 дней, агрегат по дням недели)
create or replace view public.vw_search_metrics_weekly
with (security_invoker = false) as
select
  marketplace,
  date_trunc('week', created_at at time zone 'UTC')::date as week_start,
  count(*)::bigint as total_requests,
  count(*) filter (where success)::bigint as successful_requests,
  round(
    100.0 * count(*) filter (where success) / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  round(avg(response_time_ms)::numeric, 0) as avg_response_time_ms
from public.search_metrics
where created_at >= now() - interval '7 days'
group by marketplace, date_trunc('week', created_at at time zone 'UTC')::date
order by week_start desc, marketplace;

-- Статистика AI-запросов
create or replace view public.vw_ai_requests
with (security_invoker = false) as
select
  provider,
  model,
  date_trunc('day', created_at at time zone 'UTC')::date as day,
  count(*)::bigint as request_count,
  count(*) filter (where success)::bigint as success_count,
  count(*) filter (where not success)::bigint as error_count,
  round(avg(duration_ms)::numeric, 0) as avg_duration_ms,
  round(
    avg(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))::numeric,
    0
  ) as avg_total_tokens,
  sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))::bigint as total_tokens
from public.ai_request_log
where created_at >= now() - interval '30 days'
group by provider, model, date_trunc('day', created_at at time zone 'UTC')::date
order by day desc, provider, model;

-- Алерт: success rate WB за 24 часа
create or replace view public.vw_wb_success_rate_24h
with (security_invoker = false) as
select
  count(*)::bigint as total_requests,
  count(*) filter (where success)::bigint as successful_requests,
  round(
    100.0 * count(*) filter (where success) / nullif(count(*), 0),
    2
  ) as success_rate_pct,
  round(avg(response_time_ms)::numeric, 0) as avg_response_time_ms
from public.search_metrics
where marketplace = 'wildberries'
  and created_at >= now() - interval '24 hours';

-- ============================================================================
-- 5. RLS — tracked_products (пользователь видит только свои записи)
-- ============================================================================

-- Удаляем старые политики, если были
drop policy if exists tracked_products_select_own on public.tracked_products;
drop policy if exists tracked_products_insert_own on public.tracked_products;
drop policy if exists tracked_products_update_own on public.tracked_products;
drop policy if exists tracked_products_delete_own on public.tracked_products;

create policy tracked_products_select_own
  on public.tracked_products
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy tracked_products_insert_own
  on public.tracked_products
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy tracked_products_update_own
  on public.tracked_products
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy tracked_products_delete_own
  on public.tracked_products
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Views и служебные таблицы остаются без публичных политик (доступ через Edge Functions + service_role)
