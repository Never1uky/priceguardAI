-- PriceGuard AI — pg_cron для update-prices (каждые 6 часов)
-- Проект: ihlfvpocwobvcpxbypsd
--
-- ПЕРЕД ЗАПУСКОМ:
-- 1. Dashboard → Database → Extensions → включите pg_cron и pg_net (pg_net = "http")
-- 2. Задайте секрет: supabase secrets set UPDATE_PRICES_CRON_SECRET=...
-- 3. В этом файле замените ТОЛЬКО в SQL Editor (не коммитьте ключи):
--      __SERVICE_ROLE_KEY__  → Settings → API → service_role (secret)
--      __CRON_SECRET__       → то же значение, что UPDATE_PRICES_CRON_SECRET
-- 4. SQL Editor → New query → вставьте → Run
--
-- Альтернатива без подстановки в SQL: GitHub Actions
--   .github/workflows/update-prices.yml (секреты SUPABASE_URL + UPDATE_PRICES_CRON_SECRET)
--
-- Опционально через Vault (вместо плейсхолдеров ниже):
--   select vault.create_secret('priceguard_service_role', '<service_role_jwt>');
--   select vault.create_secret('priceguard_update_prices_cron', '<cron_secret>');
--   и в headers используйте:
--     (select decrypted_secret from vault.decrypted_secrets where name = 'priceguard_service_role' limit 1)
--     (select decrypted_secret from vault.decrypted_secrets where name = 'priceguard_update_prices_cron' limit 1)

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Убрать старое расписание, если есть
select cron.unschedule(jobid)
from cron.job
where jobname = 'priceguard-update-prices';

-- Каждые 6 часов (UTC)
select cron.schedule(
  'priceguard-update-prices',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/update-prices',
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

-- Проверка
select jobid, jobname, schedule, active from cron.job where jobname = 'priceguard-update-prices';
