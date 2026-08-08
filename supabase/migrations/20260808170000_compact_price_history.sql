-- Compact product_price_history: keep full resolution for 30 days, then
-- downsample older points into time buckets that retain only the min and
-- max price per bucket (never the average/naive-nth-point — that would risk
-- losing a real sale/spike). Chart-friendly: a year of history collapses to
-- roughly 2 points per week-bucket for months 2-12, then 2 per month-bucket
-- beyond a year, instead of growing unboundedly forever.
--
-- Idempotent by construction: re-running after a bucket is already down to
-- its min+max rows will just re-select those same two rows as min/max and
-- delete nothing further — safe to run on a recurring schedule.
--
-- Real recorded_at timestamps are preserved (not synthesized), so charts
-- still show *when* the min/max actually happened.

create or replace function public.compact_price_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_weekly bigint := 0;
  deleted_monthly bigint := 0;
begin
  -- Tier 1: 30 days – 1 year old → weekly buckets, keep min+max only.
  with in_range as (
    select id, user_id, marketplace, product_id, price, recorded_at,
           date_trunc('week', recorded_at) as bucket
    from public.product_price_history
    where recorded_at < now() - interval '30 days'
      and recorded_at >= now() - interval '365 days'
  ),
  keep_min as (
    select distinct on (user_id, marketplace, product_id, bucket) id
    from in_range
    order by user_id, marketplace, product_id, bucket, price asc, recorded_at asc
  ),
  keep_max as (
    select distinct on (user_id, marketplace, product_id, bucket) id
    from in_range
    order by user_id, marketplace, product_id, bucket, price desc, recorded_at asc
  ),
  to_delete as (
    select id from in_range
    except
    select id from keep_min
    except
    select id from keep_max
  )
  delete from public.product_price_history
  where id in (select id from to_delete);
  get diagnostics deleted_weekly = row_count;

  -- Tier 2: older than 1 year → monthly buckets, keep min+max only.
  with in_range as (
    select id, user_id, marketplace, product_id, price, recorded_at,
           date_trunc('month', recorded_at) as bucket
    from public.product_price_history
    where recorded_at < now() - interval '365 days'
  ),
  keep_min as (
    select distinct on (user_id, marketplace, product_id, bucket) id
    from in_range
    order by user_id, marketplace, product_id, bucket, price asc, recorded_at asc
  ),
  keep_max as (
    select distinct on (user_id, marketplace, product_id, bucket) id
    from in_range
    order by user_id, marketplace, product_id, bucket, price desc, recorded_at asc
  ),
  to_delete as (
    select id from in_range
    except
    select id from keep_min
    except
    select id from keep_max
  )
  delete from public.product_price_history
  where id in (select id from to_delete);
  get diagnostics deleted_monthly = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted_weekly_tier', deleted_weekly,
    'deleted_monthly_tier', deleted_monthly,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.compact_price_history() from public;
grant execute on function public.compact_price_history() to service_role;

comment on function public.compact_price_history() is
  'Downsamples product_price_history older than 30 days into weekly (30d-1y) '
  'then monthly (1y+) buckets, keeping only the min and max price row per bucket. '
  'Never deletes data younger than 30 days. Idempotent, safe to schedule daily/weekly.';
