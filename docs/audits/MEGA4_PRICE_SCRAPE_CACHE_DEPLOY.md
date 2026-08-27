# MEGA-4 — Shared `price_scrape_cache` for Megamarket

**Date:** 2026-08-26  
**Out of scope:** Telegram monitoring, `update-prices` cron, `monitoring_enabled` for Mega.

## What changed

1. **DB:** `price_scrape_cache_marketplace_check` allows `megamarket` (migration `20260826193000_megamarket_price_scrape_cache.sql`).
2. **Edge `price-scrape-cache` / `price-cache`:** Mega VALID; bare goodsId key (digits).
3. **Edge `fetch-product-price`:** Mega reads/writes shared cache (no longer `cacheable === false`).
4. **Client:** `skipCache: false` for Mega unlocker; `getSharedPriceCache` / `putSharedPriceCache` already take `ComparisonMarketplace` including Mega. Cache hit short-circuits before HiddenBrowser.

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
# 1. Migration (applied 2026-08-26 via MCP as megamarket_price_scrape_cache)
#    File: supabase/migrations/20260826193000_megamarket_price_scrape_cache.sql

# 2. Redeploy Edge (shared deps + VALID)
npx supabase functions deploy price-cache --project-ref ihlfvpocwobvcpxbypsd
npx supabase functions deploy fetch-product-price --project-ref ihlfvpocwobvcpxbypsd
```

## Verify

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conname = 'price_scrape_cache_marketplace_check';
-- must include megamarket

select monitoring_marketplaces, scrappey_marketplaces
from public.app_cost_guards
limit 1;
-- monitoring = trio only; scrappey may include megamarket (MEGA-3)
```

Smoke: Premium unlocker Mega SKU twice within 6h → second call `source: cache` (no Scrappey). Extension compare refresh with fresh shared row → no HiddenBrowser tab.

## Rollback note

Drop Mega from CHECK only if no Mega rows remain in `price_scrape_cache`; otherwise delete Mega rows first. Do **not** re-enable Telegram/cron for Mega as part of rollback.
