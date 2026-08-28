-- Reliability / search_metrics: allow megamarket + aliexpress (same payload contract as CORE trio).
-- Not a monitoring / Telegram allowlist.

alter table public.search_metrics
  drop constraint if exists search_metrics_marketplace_check;

alter table public.search_metrics
  add constraint search_metrics_marketplace_check check (
    marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress'
    )
  );

comment on constraint search_metrics_marketplace_check on public.search_metrics is
  'CORE trio + megamarket + aliexpress for Reliability dashboard. Not product Telegram / monitoring.';
