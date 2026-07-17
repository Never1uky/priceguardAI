-- PriceGuard AI v2.7.1 — перенос tracked_products device_id → user_id без потери данных
--
-- Сценарий:
--   1. Legacy-строки: device_id заполнен, user_id NULL
--   2. При первом входе клиент вызывает claim_tracked_products_by_device(device_id, user_id)
--   3. Строки привязываются к аккаунту; дубликаты сливаются

-- ============================================================================
-- 1. Восстановить device_id (если удалён миграцией v2.7)
-- ============================================================================

alter table public.tracked_products
  add column if not exists device_id text;

-- user_id может быть NULL у legacy-записей до claim
alter table public.tracked_products
  alter column user_id drop not null;

-- Уникальность для legacy (только незаклеймленные строки)
drop index if exists tracked_products_device_claim_idx;
create unique index tracked_products_device_claim_idx
  on public.tracked_products (device_id, marketplace, product_id)
  where device_id is not null and user_id is null;

create index if not exists tracked_products_device_lookup_idx
  on public.tracked_products (device_id)
  where device_id is not null and user_id is null;

-- Проверка: у заклеймленной строки должен быть user_id
alter table public.tracked_products drop constraint if exists tracked_products_owner_check;
alter table public.tracked_products add constraint tracked_products_owner_check
  check (
    user_id is not null
    or (device_id is not null and user_id is null)
  );

-- ============================================================================
-- 2. RPC: привязать legacy-записи device_id к user_id
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
    select id, marketplace, product_id, deleted
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
      -- У пользователя уже есть этот товар — удаляем legacy-дубликат
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
-- 3. Realtime для tracked_products (мгновенная синхронизация)
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

-- RLS: authenticated может читать свои строки (для Realtime)
-- Политики из v2.7 уже созданы
