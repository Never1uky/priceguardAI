-- MEGA-3: allow Megamarket on Scrappey unlocker allowlist only.
-- Do NOT change monitoring_marketplaces (Telegram / cron stay trio-only).

update public.monitoring_cost_guards
set
  scrappey_marketplaces = array['wildberries', 'ozon', 'yandex_market', 'megamarket']::text[],
  updated_at = now()
where id = 1;
