-- Scrappey replaces Bright Data in price_scrape_cache source tag

update public.price_scrape_cache
  set source = 'scrappey'
  where source = 'brightdata';

alter table public.price_scrape_cache
  drop constraint if exists price_scrape_cache_source_check;

alter table public.price_scrape_cache
  add constraint price_scrape_cache_source_check
  check (source in ('scrappey', 'legacy', 'cache'));

comment on table public.price_scrape_cache is
  'TTL ~2h price cache for update-prices / Scrappey (service_role only)';

comment on column public.user_alert_settings.brightdata_api_key is
  'DEPRECATED: legacy BYOK Bright Data key (unused; Scrappey via SCRAPPEY_API_KEY secret)';
comment on column public.user_alert_settings.brightdata_zone is
  'DEPRECATED: legacy Bright Data zone (unused)';
