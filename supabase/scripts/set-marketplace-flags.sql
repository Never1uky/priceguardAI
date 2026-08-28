-- Ops: per-marketplace feature flags (Phase 10).
-- marketplace_enabled = extension compare; monitoring_enabled = Telegram cron.

-- Compare-only test rollout (Megamarket in manual compare, no Telegram monitoring):
--   update public.marketplace_flags
--   set marketplace_enabled = true,
--       monitoring_enabled = false,
--       note = 'compare-only pilot',
--       updated_at = now()
--   where marketplace_id = 'megamarket';

-- Full rollout (compare + monitoring):
--   update public.marketplace_flags
--   set marketplace_enabled = true,
--       monitoring_enabled = true,
--       updated_at = now()
--   where marketplace_id = 'megamarket';

-- Emergency kill monitoring for one MP (compare still on):
--   update public.marketplace_flags
--   set monitoring_enabled = false, updated_at = now()
--   where marketplace_id = 'ozon';

-- Env overlay (Edge secrets, wins over DB):
--   MARKETPLACE_FLAGS_JSON={"megamarket":{"marketplace_enabled":true,"monitoring_enabled":false}}
-- MVIDEO-2 (compare on, monitoring off):
--   update public.marketplace_flags set marketplace_enabled = true, monitoring_enabled = false
--   where marketplace_id = 'mvideo';

select marketplace_id, marketplace_enabled, monitoring_enabled, note, updated_at
from public.marketplace_flags
order by marketplace_id;
