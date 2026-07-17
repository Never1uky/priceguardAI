-- Обратная связь по выбору кандидата (обучение матчинга).
-- Пока пишем accepted=true при ручном выборе; веса скорректируем позже.

create table if not exists public.match_feedback (
  id uuid primary key default gen_random_uuid(),
  source_marketplace text not null
    check (source_marketplace in ('wildberries', 'ozon', 'yandex_market')),
  source_product_id text not null,
  target_marketplace text not null
    check (target_marketplace in ('wildberries', 'ozon', 'yandex_market')),
  candidate_product_id text not null,
  candidate_url text not null,
  accepted boolean not null default true,
  match_confidence integer,
  priority integer,
  created_at timestamptz not null default now()
);

create index if not exists match_feedback_source_idx
  on public.match_feedback (source_marketplace, source_product_id, target_marketplace);

create index if not exists match_feedback_candidate_idx
  on public.match_feedback (target_marketplace, candidate_product_id, accepted);

alter table public.match_feedback enable row level security;
-- Доступ только через Edge Function с service_role.
