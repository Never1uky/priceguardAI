# MVIDEO-4 — Shared `price_scrape_cache` for М.Видео

**Date:** 2026-08-27  
**Out of scope:** Telegram monitoring, `update-prices` cron, `monitoring_enabled` for mvideo.

## What changed

1. **DB:** `price_scrape_cache_marketplace_check` allows `mvideo` (migration `20260827192000_mvideo_price_scrape_cache.sql`).
2. **Edge `price-cache`:** mvideo VALID; bare article id key (6+ digits).
3. **Edge `fetch-product-price`:** mvideo reads/writes shared cache (identity via `/products/…{id}` or Eldorado paths).
4. **Client:** `skipCache: false` for mvideo unlocker; `getSharedPriceCache` already takes `ComparisonMarketplace` including mvideo. Cache hit short-circuits before HiddenBrowser.

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
# 1. Migration (applied via MCP as mvideo_price_scrape_cache)
#    File: supabase/migrations/20260827192000_mvideo_price_scrape_cache.sql

# 2. Redeploy Edge (shared deps + VALID)
npx supabase functions deploy price-cache --project-ref ihlfvpocwobvcpxbypsd
npx supabase functions deploy fetch-product-price --project-ref ihlfvpocwobvcpxbypsd
```

## Verify

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conname = 'price_scrape_cache_marketplace_check';
-- must include mvideo

select scrappey_marketplaces, monitoring_marketplaces
from public.monitoring_cost_guards
where id = 1;
-- scrappey may include mvideo (MVIDEO-3); monitoring = trio only
```

Smoke: Premium unlocker mvideo SKU twice within 6h → second call `source: cache` (no Scrappey). Extension compare refresh with fresh shared row → no HiddenBrowser tab.

## Rollback note

Drop mvideo from CHECK only if no mvideo rows remain in `price_scrape_cache`; otherwise delete mvideo rows first. Do **not** re-enable Telegram/cron for mvideo as part of rollback.
