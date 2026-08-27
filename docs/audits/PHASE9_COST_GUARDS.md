# Phase 9 — Cost guards (server)

## Verdict

Critical limits live on the **server** (`monitoring_cost_guards` + env kill-switches).  
Extension UI caps are UX only — cron / Telegram / unlocker enforce guards.

## Controls

| Need | Field / env |
|------|-------------|
| Tracked product caps | `free_track_limit`, `premium_track_limit` / `COST_GUARDS_*_TRACK_LIMIT` |
| Check frequency | `fresh_ms_free`, `fresh_ms_premium` / `COST_GUARDS_FRESH_MS_*` |
| Disable MP monitoring | `monitoring_marketplaces` / `COST_GUARDS_MONITORING_MARKETPLACES` |
| Disable expensive Scrappey MP | `scrappey_marketplaces` / `COST_GUARDS_SCRAPPEY_MARKETPLACES` |
| Kill Scrappey | `scrappey_enabled=false` / `COST_GUARDS_SCRAPPEY_ENABLED=0` |
| Cache TTL | `price_cache_ttl_ms` / `COST_GUARDS_PRICE_CACHE_TTL_MS` |
| Circuit / batch | `scrappey_circuit_after`, `max_groups_per_run` |

**Priority:** env > DB row > code defaults.

## Change without extension publish

1. SQL Editor: `supabase/scripts/set-cost-guards.sql` examples  
2. Or `supabase secrets set COST_GUARDS_SCRAPPEY_ENABLED=0` (instant kill)

## Wired

- `update-prices` — caps, freshness, MP allowlist, Scrappey, cache TTL, circuit  
- `telegram-webhook` — `/add` caps + MP + Scrappey  
- `fetch-product-price` — Scrappey guards  

## Not trusted on client

Local chrome.storage / popup limits cannot unlock unlimited server monitoring.

## Deploy

1. Apply migration `20260825234500_monitoring_cost_guards.sql`  
2. Redeploy `update-prices`, `telegram-webhook`, `fetch-product-price`
