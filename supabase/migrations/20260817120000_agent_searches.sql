-- AI Shopping Agent: per-user search state + short-lived SERP cache.
-- agent_searches — пользовательские данные (не TTL-кэш; retention = Stage 9).
-- search_results_cache — кэш выдачи по запросу (не по товару), только service_role.

create table if not exists public.agent_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  constraints jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'searching', 'evaluating', 'ranking', 'done', 'failed')),
  steps_taken int not null default 0,
  cost_estimate_rub numeric,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agent_searches is
  'Состояние и cost-трекинг одного запроса AI Shopping Agent. Живёт с аккаунтом, не покрывается purge_privacy_ttl_data().';

create index if not exists agent_searches_user_created_idx
  on public.agent_searches (user_id, created_at desc);

alter table public.agent_searches enable row level security;

drop policy if exists agent_searches_select_own on public.agent_searches;
drop policy if exists agent_searches_update_own on public.agent_searches;

create policy agent_searches_select_own
  on public.agent_searches
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy agent_searches_update_own
  on public.agent_searches
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.search_results_cache (
  id uuid primary key default gen_random_uuid(),
  normalized_query text not null,
  marketplace text not null
    check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  candidates jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (normalized_query, marketplace)
);

comment on table public.search_results_cache is
  'Короткоживущий кэш SERP по нормализованному запросу (не product_cache). TTL 6h через purge_privacy_ttl_data().';

create index if not exists search_results_cache_fetched_idx
  on public.search_results_cache (fetched_at desc);

alter table public.search_results_cache enable row level security;

-- Как product_cache / price_scrape_cache: RLS без policy.
-- Явный revoke — чтобы anon/authenticated не ходили в таблицу через PostgREST.
revoke all on table public.search_results_cache from anon, authenticated;
grant all on table public.search_results_cache to service_role;
