-- Phase 9: server-side monitoring cost guards (singleton).
-- Change via SQL Editor — no extension republish. Env kill-switches still win.

create table if not exists public.monitoring_cost_guards (
  id integer primary key default 1 check (id = 1),
  free_track_limit integer not null default 5
    check (free_track_limit >= 0 and free_track_limit <= 500),
  premium_track_limit integer not null default 50
    check (premium_track_limit >= 0 and premium_track_limit <= 500),
  fresh_ms_free bigint not null default 21600000
    check (fresh_ms_free >= 600000),
  fresh_ms_premium bigint not null default 10800000
    check (fresh_ms_premium >= 600000),
  scrappey_enabled boolean not null default true,
  -- Marketplaces eligible for Telegram cron monitoring
  monitoring_marketplaces text[] not null default array['wildberries', 'ozon', 'yandex_market']::text[],
  -- Marketplaces allowed to call Scrappey (others: card/legacy only)
  scrappey_marketplaces text[] not null default array['wildberries', 'ozon', 'yandex_market']::text[],
  price_cache_ttl_ms bigint not null default 21600000
    check (price_cache_ttl_ms >= 300000),
  scrappey_circuit_after integer not null default 8
    check (scrappey_circuit_after >= 1 and scrappey_circuit_after <= 1000),
  max_groups_per_run integer not null default 160
    check (max_groups_per_run >= 1 and max_groups_per_run <= 2000),
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.monitoring_cost_guards is
  'Singleton cost/ops guards for Telegram monitoring + Scrappey. Service role / Edge only.';

alter table public.monitoring_cost_guards enable row level security;
-- No policies for anon/authenticated — service_role only.

insert into public.monitoring_cost_guards (id)
values (1)
on conflict (id) do nothing;
