-- Анонимная статистика проверок «Оригинал» (без PII)
create table if not exists public.authenticity_events (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  article text,
  status text not null check (status in ('original', 'not_original', 'unknown')),
  source text not null check (source in ('track', 'compare', 'scrape')),
  extension_version text,
  created_at timestamptz not null default now()
);

create index if not exists authenticity_events_created_at_idx
  on public.authenticity_events (created_at desc);

alter table public.authenticity_events enable row level security;

-- Прямой доступ из клиента закрыт; запись только через Edge Function (service role)
