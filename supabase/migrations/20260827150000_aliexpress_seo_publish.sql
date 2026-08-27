-- ALI-8: SEO publish allowlist DB CHECKs for aliexpress.
-- Does not enable Telegram / monitoring. Publish still requires evaluateSeoPublishGates.

alter table public.seo_product_pages
  drop constraint if exists seo_product_pages_marketplace_check;

alter table public.seo_product_pages
  add constraint seo_product_pages_marketplace_check check (
    marketplace in ('wildberries', 'ozon', 'yandex_market', 'megamarket', 'aliexpress')
  );

comment on constraint seo_product_pages_marketplace_check on public.seo_product_pages is
  'CORE trio + megamarket + aliexpress (MEGA-8/ALI-8 SEO publishAllowed). Gates still apply per page.';

-- product_cache: Full Analysis snapshots that seed seo-publish
alter table public.product_cache
  drop constraint if exists product_cache_marketplace_check;

alter table public.product_cache
  add constraint product_cache_marketplace_check check (
    marketplace in ('wildberries', 'ozon', 'yandex_market', 'megamarket', 'aliexpress')
  );

-- offers_snapshot cross-MP mapping may include Ali as source or target
alter table public.cross_market_mapping
  drop constraint if exists cross_market_mapping_source_marketplace_check;

alter table public.cross_market_mapping
  add constraint cross_market_mapping_source_marketplace_check check (
    source_marketplace in ('wildberries', 'ozon', 'yandex_market', 'megamarket', 'aliexpress')
  );

alter table public.cross_market_mapping
  drop constraint if exists cross_market_mapping_target_marketplace_check;

alter table public.cross_market_mapping
  add constraint cross_market_mapping_target_marketplace_check check (
    target_marketplace in ('wildberries', 'ozon', 'yandex_market', 'megamarket', 'aliexpress')
  );
