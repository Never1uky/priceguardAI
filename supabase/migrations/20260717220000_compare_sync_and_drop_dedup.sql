-- Compare list cloud sync + drop-alert dedup columns

-- ============================================================================
-- compare_products (per-user comparison list)
-- ============================================================================

create table if not exists public.compare_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  payload jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compare_products_user_product_unique unique (user_id, product_id)
);

create index if not exists compare_products_user_updated_idx
  on public.compare_products (user_id, updated_at desc);

alter table public.compare_products enable row level security;

drop policy if exists compare_products_select_own on public.compare_products;
drop policy if exists compare_products_insert_own on public.compare_products;
drop policy if exists compare_products_update_own on public.compare_products;
drop policy if exists compare_products_delete_own on public.compare_products;

create policy compare_products_select_own
  on public.compare_products for select
  to authenticated
  using (auth.uid() = user_id);

create policy compare_products_insert_own
  on public.compare_products for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy compare_products_update_own
  on public.compare_products for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy compare_products_delete_own
  on public.compare_products for delete
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- Drop alert cooldown on tracked_products
-- ============================================================================

alter table public.tracked_products
  add column if not exists last_drop_notified_at timestamptz;

alter table public.tracked_products
  add column if not exists last_drop_notified_price numeric;
