-- OOS / unavailable scrape backoff for update-prices cron

alter table public.tracked_products
  add column if not exists consecutive_unavailable_count int not null default 0,
  add column if not exists unavailable_since timestamptz null;

comment on column public.tracked_products.consecutive_unavailable_count is
  'Consecutive update-prices OOS/unavailable results; drives scrape backoff';
comment on column public.tracked_products.unavailable_since is
  'First consecutive OOS timestamp; cleared when a successful price fetch returns';

-- Existing OOS rows: start mild backoff instead of hammering Scrappey every run
update public.tracked_products
set
  consecutive_unavailable_count = 1,
  unavailable_since = coalesce(unavailable_since, updated_at, now())
where last_fetch_error = 'out_of_stock_or_unavailable'
  and consecutive_unavailable_count = 0;
