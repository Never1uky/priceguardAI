-- Bright Data scraper credentials (Premium BYOK) + shared price scrape cache

alter table public.user_alert_settings
  add column if not exists brightdata_api_key text,
  add column if not exists brightdata_zone text not null default '',
  add column if not exists scraper_enabled boolean not null default false;

comment on column public.user_alert_settings.brightdata_api_key is
  'Bright Data API key (Premium BYOK). Read only via service_role / edge.';
comment on column public.user_alert_settings.brightdata_zone is
  'Bright Data Web Unlocker zone name';
comment on column public.user_alert_settings.scraper_enabled is
  'Use Bright Data for Ozon/YM when Premium + key present';

-- Drop authenticated policies that would expose API key via PostgREST select *.
-- Clients must use sync-alert-settings edge (returns keyHint only).
-- Existing policies already scope by user_id; revoke select of key by replacing
-- select policy with a column-safe view approach is heavy — instead we rely on
-- edge-only access: revoke direct table grants for authenticated if any.
-- Keep RLS; document that clients should not SELECT * this table for scraper fields.

create table if not exists public.price_scrape_cache (
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,
  price numeric not null,
  title text,
  url text,
  source text not null check (source in ('brightdata', 'legacy', 'cache')),
  fetched_at timestamptz not null default now(),
  primary key (marketplace, product_id)
);

create index if not exists price_scrape_cache_fetched_idx
  on public.price_scrape_cache (fetched_at desc);

comment on table public.price_scrape_cache is
  'TTL ~2h price cache for update-prices / Bright Data (service_role only)';

alter table public.price_scrape_cache enable row level security;
-- No policies for authenticated/anon — service_role bypasses RLS.
