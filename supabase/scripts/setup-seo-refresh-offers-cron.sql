-- PriceGuard AI — pg_cron for seo-refresh-offers (every 6 hours, +30m after update-prices)
-- Project: ihlfvpocwobvcpxbypsd
--
-- BEFORE RUNNING:
-- 1. Dashboard → Database → Extensions → pg_cron and pg_net enabled
-- 2. Same secrets as update-prices: UPDATE_PRICES_CRON_SECRET
-- 3. In SQL Editor replace ONLY (do not commit keys):
--      __SERVICE_ROLE_KEY__  → Settings → API → service_role
--      __CRON_SECRET__       → same value as UPDATE_PRICES_CRON_SECRET
-- 4. SQL Editor → New query → paste → Run
--
-- GitHub backup: .github/workflows/seo-refresh-offers.yml
--   secrets SUPABASE_URL + UPDATE_PRICES_CRON_SECRET (already used by update-prices)
--
-- This job copies price_scrape_cache + cross_market_mapping into
-- seo_product_pages.offers_snapshot. It does NOT scrape. Seed product_ids
-- (seed-*) will stay empty until rebound to real marketplace SKUs.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'priceguard-seo-refresh-offers';

-- 30 minutes after update-prices (0 */6 UTC)
select cron.schedule(
  'priceguard-seo-refresh-offers',
  '30 */6 * * *',
  $$
  select net.http_post(
    url := 'https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/seo-refresh-offers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SERVICE_ROLE_KEY__',
      'x-cron-secret', '__CRON_SECRET__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select jobid, jobname, schedule, active from cron.job where jobname = 'priceguard-seo-refresh-offers';
