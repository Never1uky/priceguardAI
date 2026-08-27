-- ALI-4: price_scrape_cache accepts aliexpress (shared Premium/unlocker + client cache).
-- monitoring / Telegram cron unchanged.

alter table public.price_scrape_cache
  drop constraint if exists price_scrape_cache_marketplace_check;

alter table public.price_scrape_cache
  add constraint price_scrape_cache_marketplace_check check (
    marketplace in ('wildberries', 'ozon', 'yandex_market', 'megamarket', 'aliexpress')
  );

comment on constraint price_scrape_cache_marketplace_check on public.price_scrape_cache is
  'CORE trio + megamarket + aliexpress (MEGA-4/ALI-4 shared Scrappey/client price cache). Not a monitoring allowlist.';
