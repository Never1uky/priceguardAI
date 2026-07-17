-- PriceGuard AI v2.7.6 — полная настройка Auth + миграция device_id → user_id (без TRUNCATE)
--
-- Безопасно применять поверх существующей БД: только ADD IF NOT EXISTS / пересоздание политик.
-- Сценарий миграции данных:
--   1. Legacy: tracked_products с device_id, user_id IS NULL
--   2. Первый вход: RPC claim_tracked_products_by_device(device_id, user_id)
--   3. Клиент push локальных товаров через tracked-sync (JWT)

-- ============================================================================
-- 1. Колонки tracked_products
-- ============================================================================

alter table public.tracked_products
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.tracked_products
  add column if not exists notes text;

alter table public.tracked_products
  add column if not exists device_id text;

-- Legacy-строки могут иметь user_id NULL до claim
alter table public.tracked_products
  alter column user_id drop not null;

alter table public.tracked_products
  alter column device_id drop not null;

-- ============================================================================
-- 2. Индексы и ограничения
-- ============================================================================
-- UNIQUE CONSTRAINT и индекс часто имеют одно имя: сначала DROP CONSTRAINT, потом INDEX.

alter table public.tracked_products
  drop constraint if exists tracked_products_user_mp_product_unique;
drop index if exists public.tracked_products_user_mp_product_unique;

create unique index if not exists tracked_products_user_mp_product_unique
  on public.tracked_products (user_id, marketplace, product_id)
  where user_id is not null;

alter table public.tracked_products
  drop constraint if exists tracked_products_device_claim_idx;
drop index if exists public.tracked_products_device_claim_idx;

create unique index if not exists tracked_products_device_claim_idx
  on public.tracked_products (device_id, marketplace, product_id)
  where device_id is not null and user_id is null;

create index if not exists tracked_products_user_updated_idx
  on public.tracked_products (user_id, updated_at desc)
  where user_id is not null;

create index if not exists tracked_products_device_lookup_idx
  on public.tracked_products (device_id)
  where device_id is not null and user_id is null;

alter table public.tracked_products drop constraint if exists tracked_products_owner_check;
alter table public.tracked_products add constraint tracked_products_owner_check
  check (
    user_id is not null
    or (device_id is not null and user_id is null)
  );

-- ============================================================================
-- 3. RPC: claim device_id → user_id
-- ============================================================================

create or replace function public.claim_tracked_products_by_device(
  p_device_id text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_claimed int := 0;
  v_merged int := 0;
begin
  if p_device_id is null or length(trim(p_device_id)) = 0 then
    return jsonb_build_object('claimed', 0, 'merged', 0, 'error', 'device_id required');
  end if;
  if p_user_id is null then
    return jsonb_build_object('claimed', 0, 'merged', 0, 'error', 'user_id required');
  end if;

  for rec in
    select id, marketplace, product_id
    from public.tracked_products
    where device_id = p_device_id
      and user_id is null
    order by updated_at desc
  loop
    if exists (
      select 1
      from public.tracked_products t2
      where t2.user_id = p_user_id
        and t2.marketplace = rec.marketplace
        and t2.product_id = rec.product_id
    ) then
      delete from public.tracked_products where id = rec.id;
      v_merged := v_merged + 1;
    else
      update public.tracked_products
      set
        user_id = p_user_id,
        device_id = null,
        updated_at = now()
      where id = rec.id;
      v_claimed := v_claimed + 1;
    end if;
  end loop;

  return jsonb_build_object('claimed', v_claimed, 'merged', v_merged);
end;
$$;

revoke all on function public.claim_tracked_products_by_device(text, uuid) from public;
grant execute on function public.claim_tracked_products_by_device(text, uuid) to service_role;

-- ============================================================================
-- 4. RLS — tracked_products по user_id (authenticated)
-- ============================================================================

alter table public.tracked_products enable row level security;

drop policy if exists tracked_products_select_own on public.tracked_products;
drop policy if exists tracked_products_insert_own on public.tracked_products;
drop policy if exists tracked_products_update_own on public.tracked_products;
drop policy if exists tracked_products_delete_own on public.tracked_products;

create policy tracked_products_select_own
  on public.tracked_products
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy tracked_products_insert_own
  on public.tracked_products
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy tracked_products_update_own
  on public.tracked_products
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy tracked_products_delete_own
  on public.tracked_products
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- 5. Realtime (для мгновенной синхронизации между устройствами)
-- ============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracked_products'
  ) then
    alter publication supabase_realtime add table public.tracked_products;
  end if;
exception
  when others then
    raise notice 'supabase_realtime publication skip: %', sqlerrm;
end;
$$;
