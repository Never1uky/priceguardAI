# Telegram shared monitoring (Scrappey coalesce)

**Verdict:** shared monitoring already exists in `update-prices`. Hardened in Phase 3 so User A + User B on product X → **one** scrape job, then fan-out.

## Desired architecture

```
tracked_products (per user row)
        │
        ▼
 coalesce by marketplace + bare product_id
        │
        ▼
 one fetchMarketplacePriceDetailed  (+ price_scrape_cache)
        │
        ▼
 fan-out: update each subscriber row + per-user Telegram thresholds
```

## Existing layers

| Layer | Where | Role |
|-------|--------|------|
| SKU coalesce | `coalesceTrackedSkuGroups` → `update-prices` | One live fetch per `marketplace:bareId` per cron run |
| Freshness gate | `isPriceRowStale` | Scrape only if ≥1 subscriber is stale (Premium 3h / Free 6h) |
| Shared cache | `price_scrape_cache` TTL 6h | Cross-path hit: cron, `/add`, unlocker |
| Cron lock | `try_acquire_update_prices_lock` | Avoid overlapping cron double-scrapes |
| Core MP only | WB / Ozon / YM | Tab-tier MPs never enter Scrappey monitoring |

## What is *not* per-subscriber Scrappey

- Client Chrome backup (`skipUnlocker`) — no Scrappey
- SEO pageviews — cache/mapping only
- `price-alert-notify` — delivery only (client-supplied message)

## Remaining cost paths (intentional, not N×users)

| Path | Behavior |
|------|----------|
| Telegram `/add` | One fetch on add; cache hit if SKU scraped recently |
| Premium `fetch-product-price` / compare-research | Interactive unlocker, not TG cron |
| Distinct bare IDs | Separate groups (different SKUs) |

## Phase 3 hardening

1. Coalesce key uses `productKey` / `stripProductIdPrefix` (`ozon-123` ≡ `123`).
2. Cache read/write uses bare `product_id` (legacy prefixed rows still readable).
3. `upsertTrackedProduct` stores bare article.
4. Unit tests: `update-prices-coalesce.test.ts`.

## Deploy note

Redeploy Edge `update-prices` (and any function bundling `_shared/price-scrape-cache` / `tracked-upsert`) for production effect.

## Phase 4

Schema rewrite to PRODUCT + Subscription tables **deferred** — coalesce already implements the preferred scrape graph. See `docs/audits/PHASE4_SHARED_MONITORING_DECISION.md`.

## Phase 5

Canonical key = `marketplace` + bare `product_id`, URL fallback, never title. Last subscriber soft-delete → no cron group → no scrape. See `docs/audits/PHASE5_DEDUPLICATION.md`.

## Phase 6

Shared `price_scrape_cache` already joins extension (API put) + Telegram. TTL 6h soft+purge. AI `product_cache` separate. See `docs/audits/PHASE6_CACHE.md`.

## Phase 7

Soft failures: cooldown + counter, no false Telegram alerts. Scrappey ≤1 browser fallback; run circuit after 8 fails. See `docs/audits/PHASE7_RETRY_FAILURE.md`.

## Phase 8

Cron 6h; Free fresh 6h / Premium gate 3h; no user interval. KPI ≈ **0.5–1 ₽/mo** per unique Ozon/YM SKU. See `docs/audits/PHASE8_MONITORING_FREQUENCY.md`.

## Phase 9

Server `monitoring_cost_guards` + env kill-switches (track caps, freshness, MP, Scrappey, TTL). See `docs/audits/PHASE9_COST_GUARDS.md`.
