-- Fetch diagnostics + target-alert cooldown for server price monitoring

alter table public.tracked_products
  add column if not exists last_fetch_ok boolean,
  add column if not exists last_fetch_error text,
  add column if not exists last_target_notified_at timestamptz;

comment on column public.tracked_products.last_fetch_ok is
  'Last server/client fetch success (update-prices / extension sync)';
comment on column public.tracked_products.last_fetch_error is
  'Short reason when last fetch failed (antibot, timeout, etc.)';
comment on column public.tracked_products.last_target_notified_at is
  'Last Telegram target-price alert; used to avoid spam every cron run';
