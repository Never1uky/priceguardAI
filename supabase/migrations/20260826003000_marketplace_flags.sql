-- Phase 10: per-marketplace feature flags (compare vs Telegram monitoring).
-- Service role / Edge only — users cannot override from extension storage.

create table if not exists public.marketplace_flags (
  marketplace_id text primary key,
  marketplace_enabled boolean not null default false,
  monitoring_enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.marketplace_flags is
  'Server feature flags: marketplace_enabled=manual compare; monitoring_enabled=Telegram cron.';

comment on column public.marketplace_flags.marketplace_enabled is
  'Extension compare / search may use this MP when true.';

comment on column public.marketplace_flags.monitoring_enabled is
  'Telegram server monitoring (update-prices) when true. Requires marketplace_enabled for sane ops.';

alter table public.marketplace_flags enable row level security;

insert into public.marketplace_flags (
  marketplace_id,
  marketplace_enabled,
  monitoring_enabled,
  note
)
values
  ('wildberries', true, true, 'core'),
  ('ozon', true, true, 'core'),
  ('yandex_market', true, true, 'core'),
  ('megamarket', false, false, 'test — enable compare-only via marketplace_enabled=true'),
  ('aliexpress', false, false, 'test'),
  ('mvideo', false, false, 'test'),
  ('dns', false, false, 'test'),
  ('citilink', false, false, 'test'),
  ('lamoda', false, false, 'test — fashion category gate still applies client-side')
on conflict (marketplace_id) do nothing;
