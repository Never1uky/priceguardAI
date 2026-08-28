-- MVIDEO-3: allow M.Video on Scrappey unlocker allowlist only.
-- Do NOT change monitoring_marketplaces (Telegram / cron stay trio-only).

update public.monitoring_cost_guards
set
  scrappey_marketplaces = array[
    'wildberries',
    'ozon',
    'yandex_market',
    'megamarket',
    'aliexpress',
    'mvideo'
  ]::text[],
  updated_at = now()
where id = 1;
