-- Ops: tweak monitoring cost guards without extension republish.
-- Examples (run in SQL Editor as service / postgres):

-- Kill Scrappey globally:
--   update public.monitoring_cost_guards set scrappey_enabled = false, updated_at = now() where id = 1;

-- Monitor only WB (no Ozon/YM cron Scrappey):
--   update public.monitoring_cost_guards
--   set monitoring_marketplaces = array['wildberries']::text[],
--       scrappey_marketplaces = array[]::text[],
--       updated_at = now()
--   where id = 1;

-- Disable Scrappey for Ozon only (still monitor via legacy if any):
--   update public.monitoring_cost_guards
--   set scrappey_marketplaces = array['wildberries', 'yandex_market']::text[],
--       updated_at = now()
--   where id = 1;

-- Tighten Free track + slower checks (12h):
--   update public.monitoring_cost_guards
--   set free_track_limit = 3,
--       fresh_ms_free = 43200000,
--       updated_at = now()
--   where id = 1;

-- Env kill-switches (Edge secrets, win over DB):
--   COST_GUARDS_SCRAPPEY_ENABLED=0
--   COST_GUARDS_MONITORING_MARKETPLACES=wildberries
--   COST_GUARDS_SCRAPPEY_MARKETPLACES=ozon
--   COST_GUARDS_FREE_TRACK_LIMIT=3
--   COST_GUARDS_FRESH_MS_FREE=43200000

select * from public.monitoring_cost_guards where id = 1;
