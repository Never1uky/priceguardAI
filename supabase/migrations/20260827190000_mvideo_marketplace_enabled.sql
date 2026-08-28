-- MVIDEO-2: enable M.Video for extension compare («Где искать») without Telegram monitoring.
update public.marketplace_flags
set
  marketplace_enabled = true,
  monitoring_enabled = false,
  note = 'MVIDEO-2: compare default-on; monitoring/Telegram OFF',
  updated_at = now()
where marketplace_id = 'mvideo';
