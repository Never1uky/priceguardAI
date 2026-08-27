# Phase 6 — Price cache (Telegram ↔ extension)

## Verdict

**Already one shared price cache.** No new merge layer needed.  
**Do not mix** with AI `product_cache`.

| Layer | Table / API | Purpose |
|-------|-------------|---------|
| **Price monitoring** | `price_scrape_cache` + Edge `price-cache` / `fetchMarketplacePriceDetailed` | price, title, url |
| **AI analysis** | `product_cache` | reviews + AI — separate |

## Telegram uses

`fetchMarketplacePriceDetailed` → `getCachedPrice` / `setCachedPrice` on **`price_scrape_cache`**.

Consumers: cron `update-prices`, Telegram `/add`, Premium `fetch-product-price`, Edge `price-cache`.

## Cache key

```
PRIMARY KEY (marketplace, product_id)   -- product_id = bare article
```

Example: `('ozon', '12345')`.  
Same numeric id on WB vs Ozon = **different rows** (no cross-MP bleed).  
Writes strip `wb-` / `ozon-` / `ym-` prefixes (Phase 3/5).

## TTL

| Mechanism | Value |
|-----------|--------|
| Soft TTL (`PRICE_SCRAPE_CACHE_TTL_MS`) | **6 hours** |
| Physical purge (`purge_privacy_ttl_data`) | **6 hours** (aligned Phase 6; was 2h — fought soft TTL) |

Aligned with Free Telegram freshness (6h).

## Who reuses

| Writer | Reader |
|--------|--------|
| Cron Scrappey/legacy | Extension get, Telegram, unlocker |
| Extension **API** / public card price (`putSharedPriceCache`) | Telegram cron `/add`, unlocker |
| Premium unlocker (server) | Same |
| Extension **HiddenBrowser/tab** | **Does not write** (session/personal price — intentional) |

Auth required for Edge `price-cache` put/get (`canUseCloudFeatures`). Logged-out extension does not seed shared cache.

## Extension → scrape vs Telegram → scrape

```
Extension (logged in) API price
   → putSharedPriceCache → price_scrape_cache
Telegram cron / /add
   → getCachedPrice → HIT → no Scrappey
```

If extension only scraped via **tab**, Telegram may still Scrappey (by design).

## Conflicts

- Marketplace isolated by PK.
- AI cache never read for price jobs.
- Title is not a cache key.

## Phase 6 actions

1. Align purge TTL 6h with soft TTL (migration `20260825223000_…`).
2. Fix client comment (was “2h”).
3. Privacy / retention docs → ~6h for `price_scrape_cache` only.
4. No schema for merging AI+price.

## Deploy

- Apply migration (purge function).
- Edge already uses 6h soft TTL; redeploy optional if only migration applied.
