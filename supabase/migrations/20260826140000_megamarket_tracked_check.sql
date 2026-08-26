-- P0 Megamarket: allow marketplace='megamarket' on tracked sync + price history.
-- Additive CHECK widen only — does NOT enable monitoring, Scrappey, or SEO.
-- Other trio-only CHECKs (price_scrape_cache, product_cache, SEO, mapping, …) stay unchanged (P2/P3).

-- tracked_products: cloud sync of user-tracked Megamarket cards
alter table public.tracked_products
  drop constraint if exists tracked_products_marketplace_check;

alter table public.tracked_products
  add constraint tracked_products_marketplace_check check (
    marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket'
    )
  );

-- product_price_history: append history when Mega products are tracked/synced
alter table public.product_price_history
  drop constraint if exists product_price_history_marketplace_check;

alter table public.product_price_history
  add constraint product_price_history_marketplace_check check (
    marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket'
    )
  );

comment on constraint tracked_products_marketplace_check on public.tracked_products is
  'P0: megamarket allowed for client track sync. Monitoring/Telegram remain flag-gated off.';

comment on constraint product_price_history_marketplace_check on public.product_price_history is
  'P0: megamarket allowed when history is written for tracked Mega SKUs.';
