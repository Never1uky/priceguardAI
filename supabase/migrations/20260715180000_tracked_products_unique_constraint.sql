-- Fix ON CONFLICT for tracked_products upsert via PostgREST / supabase-js
-- Partial unique index cannot be used as onConflict target → insert/upsert fails
-- Default UNIQUE treats NULLs as distinct → legacy device_id rows (user_id NULL) still OK

drop index if exists public.tracked_products_user_mp_product_unique;

alter table public.tracked_products
  drop constraint if exists tracked_products_user_mp_product_unique;

-- Deduplicate active user-owned rows before adding constraint
delete from public.tracked_products a
  using public.tracked_products b
 where a.user_id is not null
   and a.user_id = b.user_id
   and a.marketplace = b.marketplace
   and a.product_id = b.product_id
   and a.ctid < b.ctid;

alter table public.tracked_products
  add constraint tracked_products_user_mp_product_unique
  unique (user_id, marketplace, product_id);
