-- Глобальный кэш соответствий товаров между площадками.
-- После успешного сравнения WB↔Ozon/YM сохраняем связь;
-- следующие пользователи получают карточку без поиска.

create table if not exists public.cross_market_mapping (
  id uuid primary key default gen_random_uuid(),
  source_marketplace text not null
    check (source_marketplace in ('wildberries', 'ozon', 'yandex_market')),
  source_product_id text not null,
  target_marketplace text not null
    check (target_marketplace in ('wildberries', 'ozon', 'yandex_market')),
  target_product_id text not null,
  target_url text not null,
  confidence integer,
  hits integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_marketplace, source_product_id, target_marketplace),
  check (source_marketplace <> target_marketplace)
);

create index if not exists cross_market_mapping_lookup_idx
  on public.cross_market_mapping (source_marketplace, source_product_id, target_marketplace);

create index if not exists cross_market_mapping_reverse_idx
  on public.cross_market_mapping (target_marketplace, target_product_id, source_marketplace);

alter table public.cross_market_mapping enable row level security;
-- Доступ только через Edge Function с service_role (как product_cache).
