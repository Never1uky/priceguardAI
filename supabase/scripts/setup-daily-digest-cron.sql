-- PriceGuard AI — pg_cron for daily-user-digest (~09:00 Europe/Moscow = 06:00 UTC)
--
-- Prerequisites:
-- 1. Dashboard → Database → Extensions → pg_cron + pg_net
-- 2. Deploy: npx supabase functions deploy daily-user-digest
-- 3. Migration digest_enabled applied
-- 4. Replace __CRON_SECRET__ with the SAME value as UPDATE_PRICES_CRON_SECRET
--    (must match Edge secret used by update-prices / daily-user-digest)
--
-- Manual test:
--   curl -X POST "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/daily-user-digest" ^
--     -H "x-cron-secret: YOUR_SECRET"
--
-- Do NOT commit real secrets into this file.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'priceguard-daily-user-digest';

select cron.schedule(
  'priceguard-daily-user-digest',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/daily-user-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__CRON_SECRET__'
    ),
    body := '{}'::jsonb
  );
  $$
);

select jobid, jobname, schedule, active
from cron.job
where jobname = 'priceguard-daily-user-digest';
