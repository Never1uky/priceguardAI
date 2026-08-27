# Phase 12 — Economics dashboard

Extends existing Edge `metrics-dashboard` with a first-class **`economics`** block for Telegram monitoring cost / dedup efficiency.

## Source data

| Input | Source |
|-------|--------|
| Active monitored products | `tracked_products` for users with `server_monitoring` + Telegram on |
| Unique targets | Coalesce key `marketplace:product_id` |
| Subscribers | Distinct users per target; avg / max |
| Checks / scrapes / cache / errors | Phase 11 ops events (`telegram_monitor_*`) over `periodDays` |
| Cost | Scrappey-tagged `telegram_monitor_scrape` × **4 ₽ / 1000 calls** |

## KPI map

| Card | Field |
|------|--------|
| Active monitored products | `economics.activeMonitoredProducts` |
| Unique monitoring targets | `economics.uniqueMonitoringTargets` |
| Subscribers | `economics.subscribers` (+ `monitoringUsers`) |
| Checks/day | `economics.checksPerDay` |
| Scrape requests/day | `economics.scrapeRequestsPerDay` |
| Cache hit rate | `economics.cacheHitRatePct` |
| Scrape failures | `economics.scrapeFailures` |
| Cost/day | `economics.costEstimateRubPerDay` (opt–pess) |
| Cost/month | `economics.costEstimateRubPerMonth` |
| **Avg subscribers / target** | `economics.avgSubscribersPerTarget` |
| **Scrapes / active product** | `economics.scrapeRequestsPerActiveMonitoredProduct` |

Dedup extras: `dedupFactor` (= active / unique), `estimatedScrapesSaved` (naive `checks × avgSubs` − live scrapes), `scrapeRequestsPerUniqueTarget`.

## Dedup reading

- Healthy sharing: `avgSubscribersPerTarget > 1`, `dedupFactor > 1`
- `scrapeRequestsPerActiveMonitoredProduct` **falls** as more users share the same SKU (same scrapes ÷ more rows)
- `scrapeRequestsPerUniqueTarget` stays ~checks when stale each cycle

## UI

Admin Metrics page (`src/admin/MetricsDashboard.tsx`) — Economics card grid + period selector 1/7/30d.

## Files

| | |
|--|--|
| Pure builder | `supabase/functions/_shared/economics-dashboard.ts` |
| Edge | `supabase/functions/metrics-dashboard/index.ts` → `economics` |
| Client types | `src/lib/supabase/metrics-dashboard.ts` |
| Admin UI | `src/admin/MetricsDashboard.tsx` |
| Tests | `economics-dashboard.test.ts` |

## Deploy

```bash
supabase functions deploy metrics-dashboard
```
