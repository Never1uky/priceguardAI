-- Optional: disable seed demo / test license keys before Public CWS.
-- Run manually in Supabase SQL Editor. Does NOT delete historical activations.
-- Safe for Unlisted beta if you still want demo keys — skip this file.

-- 1) Soft-disable: no new activations
update public.license_keys
set
  max_activations = 0,
  note = coalesce(note, '') || ' [disabled before CWS ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ']'
where is_demo = true
   or key_code in (
     'PGAI-DEMO-MONTH-2026',
     'PGAI-DEMO-LIFE-2026',
     'PGAI-TEST-12345-LIFE',
     'PGAI-BETA-7DAY-TEST',
     'PGAI-DEMO-MONTH-FREE'
   );

-- 2) Verify
select key_code, plan, is_demo, max_activations, note
from public.license_keys
where is_demo = true
   or key_code like 'PGAI-DEMO-%'
   or key_code like 'PGAI-TEST-%'
   or key_code like 'PGAI-BETA-%'
order by key_code;

-- Optional hard revoke of activations for demo keys only (uncomment if needed):
-- delete from public.license_activations
-- where license_key_id in (
--   select id from public.license_keys where is_demo = true or max_activations = 0
-- );
