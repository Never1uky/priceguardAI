-- Opt-in client telemetry events (WARN/ERROR batches from extension)

create table if not exists public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  level text not null check (level in ('info', 'warn', 'error')),
  stage text not null,
  name text not null,
  marketplace text check (
    marketplace is null
    or marketplace in ('wildberries', 'ozon', 'yandex_market')
  ),
  product_id text,
  query_hash text,
  success boolean,
  elapsed_ms integer,
  error_code text,
  error_message text,
  ext_version text,
  session_id text,
  trace_id text,
  payload jsonb,
  client_ts timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telemetry_events_created_at_idx
  on public.telemetry_events (created_at desc);

create index if not exists telemetry_events_user_idx
  on public.telemetry_events (user_id, created_at desc)
  where user_id is not null;

create index if not exists telemetry_events_stage_name_idx
  on public.telemetry_events (stage, name, created_at desc);

alter table public.telemetry_events enable row level security;

comment on table public.telemetry_events is
  'Opt-in extension WARN/ERROR telemetry (no prompts / emails). Service role insert via telemetry-ingest.';

-- Privacy TTL: purge with other metrics (~90d) — extend purge function callers separately if needed
