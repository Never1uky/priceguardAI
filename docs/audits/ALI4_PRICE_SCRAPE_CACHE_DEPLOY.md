# ALI-4 — Shared `price_scrape_cache` for AliExpress

**Date:** 2026-08-27  
**Out of scope:** Telegram monitoring, `update-prices` cron, `monitoring_enabled` for Ali.

## What changed

1. **DB:** `price_scrape_cache_marketplace_check` allows `aliexpress` (migration `20260827130000_aliexpress_price_scrape_cache.sql`).
2. **Edge `price-cache`:** Ali VALID; bare item id key (8+ digits).
3. **Edge `fetch-product-price`:** Ali reads/writes shared cache (identity via `/item/{id}`).
4. **Client:** `skipCache: false` for Ali unlocker; `getSharedPriceCache` / `putSharedPriceCache` already take `ComparisonMarketplace` including Ali. Cache hit short-circuits before HiddenBrowser.

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
# 1. Migration (applied via MCP as aliexpress_price_scrape_cache)
#    File: supabase/migrations/20260827130000_aliexpress_price_scrape_cache.sql

# 2. Redeploy Edge (shared deps + VALID)
npx supabase functions deploy price-cache --project-ref ihlfvpocwobvcpxbypsd
npx supabase functions deploy fetch-product-price --project-ref ihlfvpocwobvcpxbypsd
```

## Verify

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conname = 'price_scrape_cache_marketplace_check';
-- must include aliexpress

select scrappey_marketplaces, monitoring_marketplaces
from public.monitoring_cost_guards
where id = 1;
-- scrappey may include aliexpress (ALI-3); monitoring = trio only
```

Smoke: Premium unlocker Ali SKU twice within 6h → second call `source: cache` (no Scrappey). Extension compare refresh with fresh shared row → no HiddenBrowser tab.

## Rollback note

Drop Ali from CHECK only if no Ali rows remain in `price_scrape_cache`; otherwise delete Ali rows first. Do **not** re-enable Telegram/cron for Ali as part of rollback.
