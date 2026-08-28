-- MVIDEO-6: allow marketplace='mvideo' on tracked sync + price history.
-- Additive CHECK widen only — does NOT enable monitoring, Scrappey research verify, or SEO.
-- price_scrape_cache already includes mvideo (MVIDEO-4).
-- Telegram /add stays OFF (Edge product-url detectMarketplace does not return mvideo).

-- tracked_products: cloud sync of user-tracked M.Video / Eldorado cards
alter table public.tracked_products
  drop constraint if exists tracked_products_marketplace_check;

alter table public.tracked_products
  add constraint tracked_products_marketplace_check check (
    marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo'
    )
  );

-- product_price_history: append history when mvideo products are tracked/synced
alter table public.product_price_history
  drop constraint if exists product_price_history_marketplace_check;

alter table public.product_price_history
  add constraint product_price_history_marketplace_check check (
    marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo'
    )
  );

comment on constraint tracked_products_marketplace_check on public.tracked_products is
  'MEGA-6/ALI-6/MVIDEO-6: megamarket + aliexpress + mvideo allowed for client track sync. Monitoring/Telegram remain flag-gated off.';

comment on constraint product_price_history_marketplace_check on public.product_price_history is
  'MEGA-6/ALI-6/MVIDEO-6: megamarket + aliexpress + mvideo allowed when history is written for tracked SKUs.';
