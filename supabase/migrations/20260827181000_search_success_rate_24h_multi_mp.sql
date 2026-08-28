-- Multi-MP Reliability 24h success rates (WB/Ozon/YM/Mega/Ali).
-- Ops search-alerts + metrics-dashboard. Not product Telegram / monitoring.

create or replace view public.vw_search_success_rate_24h
with (security_invoker = false) as
with mps as (
  select unnest(
    array[
      'wildberries'::text,
      'ozon'::text,
      'yandex_market'::text,
      'megamarket'::text,
      'aliexpress'::text
    ]
  ) as marketplace
),
agg as (
  select
    marketplace,
    count(*)::bigint as total_requests,
    count(*) filter (where success)::bigint as successful_requests,
    round(
      100.0 * count(*) filter (where success) / nullif(count(*), 0),
      2
    ) as success_rate_pct,
    round(avg(response_time_ms)::numeric, 0) as avg_response_time_ms
  from public.search_metrics
  where created_at >= now() - interval '24 hours'
    and marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress'
    )
  group by marketplace
)
select
  m.marketplace,
  coalesce(a.total_requests, 0)::bigint as total_requests,
  coalesce(a.successful_requests, 0)::bigint as successful_requests,
  coalesce(a.success_rate_pct, 100)::numeric as success_rate_pct,
  a.avg_response_time_ms
from mps m
left join agg a using (marketplace)
order by m.marketplace;

comment on view public.vw_search_success_rate_24h is
  'Per-MP search success over 24h for Reliability / search-alerts (ops).';

-- Backward-compatible WB-only alias (same columns as before).
create or replace view public.vw_wb_success_rate_24h
with (security_invoker = false) as
select
  total_requests,
  successful_requests,
  success_rate_pct,
  avg_response_time_ms
from public.vw_search_success_rate_24h
where marketplace = 'wildberries';

revoke all on table public.vw_search_success_rate_24h from anon, authenticated;
grant select on table public.vw_search_success_rate_24h to service_role;
