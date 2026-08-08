-- PriceGuard AI — weekly product_price_history compaction (pg_cron)
-- Project: ihlfvpocwobvcpxbypsd
--
-- Requires: migration 20260808170000_compact_price_history.sql applied
-- (function public.compact_price_history).
--
-- SQL Editor → Run this file after enabling pg_cron.
-- Same pattern as setup-privacy-purge-cron.sql: migration creates the
-- function only; this script schedules the job once.

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'priceguard-compact-price-history';

-- Weekly Sunday 04:30 UTC (after privacy purge window)
select cron.schedule(
  'priceguard-compact-price-history',
  '30 4 * * 0',
  $$ select public.compact_price_history(); $$
);

select jobid, jobname, schedule, active
from cron.job
where jobname = 'priceguard-compact-price-history';
