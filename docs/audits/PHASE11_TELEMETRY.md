# Phase 11 — Operational telemetry

Privacy-safe metrics on top of existing `telemetry` stack (local ring + opt-in remote + server inserts).

## Event names

| Event | Emitter | Purpose |
|-------|---------|---------|
| `marketplace_search_started` | Extension compare | SERP/search begin per MP |
| `marketplace_search_success` | Extension | Terminal success |
| `marketplace_search_failed` | Extension | Terminal failure |
| `scrape_request` | Extension card/unlocker | Live scrape (api/tab/scrappey) |
| `scrape_cache_hit` | Extension | Shared `price_scrape_cache` hit |
| `scrape_cache_miss` | Extension | Cache checked, live path next |
| `telegram_monitor_check` | `update-prices` | Coalesced SKU group processed |
| `telegram_monitor_cache_hit` | `update-prices` | Cron used cache |
| `telegram_monitor_scrape` | `update-prices` | Cron live scrape |
| `telegram_alert_sent` | Client + cron | Alert delivered |
| `telegram_monitor_error` | `update-prices` | Timeout / fetch error |

## Privacy

**Never stored in ops payloads:** URL, title, query text, product id, chat id, email.

Allowed payload keys: `source`, `path`, `context`, `reason`, `alert_type`, `subscriber_count`, `stale_count`, `scrappey`.

Client ops events: `ops: true` → bypass INFO sampling, remote when telemetry opt-in (same as funnel).

Server cron: direct insert into `telemetry_events` via `_shared/ops-telemetry.ts`.

## Dashboard (`metrics-dashboard`)

New sections answer:

1. **Most expensive MP** — `operational.mostExpensiveMarketplaces` (cost units: scrappey=10, tab=3, api/legacy=1)
2. **Most failures** — `operational.mostFailedMarketplaces`
3. **Cache hit rate** — `operational.totals.scrapeCacheHitRatePct`, `monitorCacheHitRatePct`
4. **Scrapes per monitor check** — `operational.totals.scrapePerMonitorCheck`
5. **Alerts sent** — `operational.totals.alertsSent`
6. **Users monitoring** — `monitoringInventory.monitoringUsers`
7. **Unique targets** — `monitoringInventory.uniqueMonitoringTargets`
8. **Subscribers per target** — `monitoringInventory.avgSubscribersPerTarget`, `maxSubscribersPerTarget`

## Files

| Layer | Path |
|-------|------|
| Client | `src/lib/telemetry/ops.ts` |
| Server shared | `supabase/functions/_shared/ops-telemetry.ts` |
| Ingest | `supabase/functions/telemetry-ingest/index.ts` |
| Cron | `supabase/functions/update-prices/index.ts` |
| Dashboard | `supabase/functions/metrics-dashboard/index.ts` |
| Migration | `20260826013000_telemetry_ops_marketplaces.sql` |

## Legacy events

Existing `SEARCH_*`, `FINAL_RESULT`, `COMPARE_MP_ATTEMPT`, `TELEGRAM_SEND` remain for local debug. Phase 11 names are the **dashboard contract**.
