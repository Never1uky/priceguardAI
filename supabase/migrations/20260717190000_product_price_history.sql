-- Cloud price history for Telegram «История цены» and future charts

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,
  price numeric not null check (price > 0),
  recorded_at timestamptz not null default now()
);

create index if not exists product_price_history_lookup_idx
  on public.product_price_history (user_id, marketplace, product_id, recorded_at desc);

alter table public.product_price_history enable row level security;

comment on table public.product_price_history is
  'Точки истории цены (server cron / track). Доступ через service_role Edge.';
