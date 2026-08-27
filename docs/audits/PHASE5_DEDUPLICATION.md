# Phase 5 — Deduplication / canonical monitoring key

## Canonical key

| Priority | Key | Example |
|----------|-----|---------|
| 1 | `marketplace` + bare `product_id` | `ozon:12345` |
| 2 (fallback) | `marketplace` + id from product URL | same after `extractProductId` |
| ❌ | title | never |

Implementation: `resolveMonitoringKey` → `supabase/functions/_shared/monitoring-key.ts`  
Coalesce: `coalesceTrackedSkuGroups` uses that key only.

## Scenario checklist

| Scenario | Behavior | Status |
|----------|----------|--------|
| Different URLs, same Ozon/WB/YM id | Same `ozon:…` / `wildberries:…` group | OK |
| Extension track | `cloudTrackedProductKey` → bare article via `resolveProductArticle` (URL fallback client-side) | OK |
| Telegram `/add` | `extractProductId` → bare; `upsertTrackedProduct` strips prefix | OK |
| Re-add same user | Unique `(user_id, marketplace, product_id)` upsert; soft-delete cleared on re-add | OK |
| Multiple users | One coalesce group, one scrape, fan-out | OK |
| Delete one user | Soft `deleted=true`; other subscribers remain in next cron query | OK |
| Delete last subscriber | `update-prices` loads only `deleted=false` → empty work queue for SKU → **no scrape job** | OK |

## Last subscriber stop

```
update-prices:
  .eq('deleted', false)   // soft-deleted rows excluded
  → workQueue
  → coalesceTrackedSkuGroups
  → if no active rows for ozon:12345 → no group → no Scrappey
```

Cache row in `price_scrape_cache` may linger until TTL purge; it does **not** schedule a monitoring job by itself.

## Title safety

Two products with identical titles and different ids → two groups (covered by tests).

## Deploy

Redeploy Edge `update-prices` after merge.
