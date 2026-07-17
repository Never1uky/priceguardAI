-- Production-grade pairwise mapping: primary + alternates, status, evidence.

-- Allow multiple target products per source→target marketplace (rank 0..2)
alter table public.cross_market_mapping
  drop constraint if exists cross_market_mapping_source_marketplace_source_product_id_target_marketplace_key;

alter table public.cross_market_mapping
  add column if not exists rank integer not null default 0,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'disputed', 'dead')),
  add column if not exists evidence text not null default 'auto'
    check (evidence in ('auto', 'manual', 'multi_user')),
  add column if not exists fail_count integer not null default 0,
  add column if not exists last_verified_at timestamptz;

-- Backfill: existing rows are primary active
update public.cross_market_mapping
set rank = 0, status = coalesce(status, 'active'), evidence = coalesce(evidence, 'auto')
where rank is null or status is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cross_market_mapping_edge_unique'
  ) then
    alter table public.cross_market_mapping
      add constraint cross_market_mapping_edge_unique
      unique (source_marketplace, source_product_id, target_marketplace, target_product_id);
  end if;
end $$;

create index if not exists cross_market_mapping_lookup_status_rank_idx
  on public.cross_market_mapping (source_marketplace, source_product_id, target_marketplace, status, rank);

create index if not exists cross_market_mapping_active_lookup_idx
  on public.cross_market_mapping (source_marketplace, source_product_id, target_marketplace)
  where status = 'active';
