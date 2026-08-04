-- Edge hardening P0/P1: rate log, moderation cooldown, match_feedback.user_id, unverified status

-- Generic request log for edge rate limits (reviews-fetch, etc.)
create table if not exists public.edge_request_log (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  user_id uuid,
  device_id text,
  created_at timestamptz not null default now()
);

create index if not exists edge_request_log_endpoint_user_idx
  on public.edge_request_log (endpoint, user_id, created_at desc);

create index if not exists edge_request_log_created_idx
  on public.edge_request_log (created_at desc);

alter table public.edge_request_log enable row level security;

-- Per-user moderation of shared mappings (dispute / reportFail cooldown)
create table if not exists public.mapping_moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null check (action in ('dispute', 'reportFail')),
  source_marketplace text not null
    check (source_marketplace in ('wildberries', 'ozon', 'yandex_market')),
  source_product_id text not null,
  target_marketplace text not null
    check (target_marketplace in ('wildberries', 'ozon', 'yandex_market')),
  target_product_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists mapping_moderation_events_lookup_idx
  on public.mapping_moderation_events (
    user_id, action, source_marketplace, source_product_id, target_marketplace, target_product_id, created_at desc
  );

alter table public.mapping_moderation_events enable row level security;

-- match_feedback: attribute votes to users + optional titles for promote gates
alter table public.match_feedback
  add column if not exists user_id uuid,
  add column if not exists source_title text,
  add column if not exists candidate_title text;

create index if not exists match_feedback_user_idx
  on public.match_feedback (user_id, created_at desc)
  where user_id is not null;

-- cross_market_mapping.status: allow unverified (low-confidence manual)
alter table public.cross_market_mapping
  drop constraint if exists cross_market_mapping_status_check;

alter table public.cross_market_mapping
  add constraint cross_market_mapping_status_check
  check (status in ('active', 'disputed', 'dead', 'unverified'));

-- Promotion audit (optional diagnostics)
create table if not exists public.mapping_promotion_audit (
  id uuid primary key default gen_random_uuid(),
  source_marketplace text not null,
  source_product_id text not null,
  target_marketplace text not null,
  target_product_id text not null,
  promoted boolean not null,
  reason text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mapping_promotion_audit_edge_idx
  on public.mapping_promotion_audit (
    source_marketplace, source_product_id, target_marketplace, target_product_id, created_at desc
  );

alter table public.mapping_promotion_audit enable row level security;
