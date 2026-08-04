-- PriceGuard AI — daily privacy TTL purge (pg_cron)
-- Project: ihlfvpocwobvcpxbypsd
--
-- Requires: migration 20260717210000_privacy_ttl_purge.sql applied
-- (function public.purge_privacy_ttl_data).
--
-- SQL Editor → Run this file after enabling pg_cron.

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'priceguard-privacy-ttl-purge';

-- Daily 03:15 UTC
select cron.schedule(
  'priceguard-privacy-ttl-purge',
  '15 3 * * *',
  $$ select public.purge_privacy_ttl_data(); $$
);

select jobid, jobname, schedule, active
from cron.job
where jobname = 'priceguard-privacy-ttl-purge';
