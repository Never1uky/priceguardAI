# Prod migration status — Supabase `ihlfvpocwobvcpxbypsd`

**Date:** 2026-08-28  
**Source:** Supabase MCP `execute_sql` → `supabase_migrations.schema_migrations` + live CHECK/view defs.

---

## Summary

| Area | Prod state |
|------|------------|
| Mega / Ali / M.Video **product** migrations | **Applied** (via MCP apply_migration; timestamps differ from repo filenames) |
| Multi-MP Reliability (`search_metrics` Mega/Ali, `vw_search_success_rate_24h`) | **Applied** — 5 MPs only (no `mvideo`) |
| M.Video in `search_metrics` / Reliability 24h view | **Not applied** — MVIDEO-10 |
| `telemetry_events` marketplace CHECK | Includes `mvideo` (+ dns/citilink/lamoda) |
| `price_scrape_cache` CHECK | Includes `mvideo` |
| GitHub `origin/main` | **Behind** local — migrations exist on prod but many repo files untracked/unpushed |

---

## MP stack migrations on prod (applied)

| Prod `name` | Prod `version` | Repo file (local) | Notes |
|-------------|----------------|-------------------|--------|
| `price_scrape_cache_ttl_6h` | 20260825194339 | `20260825223000_price_scrape_cache_ttl_6h.sql` | ✓ |
| `monitoring_cost_guards` | 20260825204602 | `20260825234500_monitoring_cost_guards.sql` | ✓ |
| `marketplace_flags` | 20260825214442 | `20260826003000_marketplace_flags.sql` | ✓ |
| `telemetry_ops_marketplaces` | 20260825222010 | `20260826013000_telemetry_ops_marketplaces.sql` | ✓ |
| `megamarket_tracked_check` | 20260826114404 | `20260826140000_megamarket_tracked_check.sql` | ✓ |
| `megamarket_scrappey_allowlist` | 20260826154403 | `20260826190000_megamarket_scrappey_allowlist.sql` | ✓ |
| `megamarket_price_scrape_cache` | 20260826154940 | `20260826193000_megamarket_price_scrape_cache.sql` | ✓ |
| `megamarket_seo_publish` | 20260826163121 | `20260826200000_megamarket_seo_publish.sql` | ✓ |
| `aliexpress_scrappey_allowlist` | 20260827084836 | `20260827120000_aliexpress_scrappey_allowlist.sql` | ✓ |
| `aliexpress_price_scrape_cache` | 20260827090638 | `20260827130000_aliexpress_price_scrape_cache.sql` | ✓ |
| `aliexpress_tracked_check` | 20260827093053 | `20260827140000_aliexpress_tracked_check.sql` | ✓ |
| `aliexpress_seo_publish` | 20260827094936 | `20260827150000_aliexpress_seo_publish.sql` | ✓ |
| `search_metrics_mega_ali` | 20260827140542 | `20260827180000_search_metrics_mega_ali.sql` | ✓ |
| `search_success_rate_24h_multi_mp` | 20260827141324 | `20260827181000_search_success_rate_24h_multi_mp.sql` | ✓ 5 MPs |
| `mvideo_marketplace_enabled` | 20260827163517 | `20260827190000_mvideo_marketplace_enabled.sql` | ✓ |
| `mvideo_scrappey_allowlist` | 20260827164732 | `20260827191000_mvideo_scrappey_allowlist.sql` | ✓ |
| `mvideo_price_scrape_cache` | 20260827170143 | `20260827192000_mvideo_price_scrape_cache.sql` | ✓ |
| `mvideo_tracked_check` | 20260827172246 | `20260827193000_mvideo_tracked_check.sql` | ✓ |
| `mvideo_seo_publish` | 20260828062657 | `20260828100000_mvideo_seo_publish.sql` | ✓ |

Prod applies migrations with **MCP timestamps**; repo uses **logical filenames**. Content matches; do not re-apply unless drift detected.

---

## Live schema checks (2026-08-28)

### `search_metrics_marketplace_check`

```
wildberries | ozon | yandex_market | megamarket | aliexpress
```

**`mvideo` — absent** (MVIDEO-10).

### `vw_search_success_rate_24h`

Same five MPs in `unnest` + `WHERE marketplace IN (…)`. Zero row for `mvideo` even with traffic until MVIDEO-10.

### `telemetry_events_marketplace_check`

Includes: trio + megamarket + aliexpress + **mvideo** + dns + citilink + lamoda.

### `price_scrape_cache_marketplace_check`

Includes: trio + megamarket + aliexpress + **mvideo**.

### `marketplace_flags` (sample)

| marketplace_id | marketplace_enabled | monitoring_enabled |
|----------------|--------------------|--------------------|
| wildberries | true | **true** |
| megamarket | true | false |
| aliexpress | true | false |
| mvideo | true | false |

---

## Edge functions (prod versions, 2026-08-28)

Recent deploys observed (slug → version):

| Function | Version | MP / ops relevance |
|----------|---------|-------------------|
| `metrics-dashboard` | **41** | Uses `vw_search_success_rate_24h` (5 MPs), Economics, funnel ops |
| `search-alerts` | **38** | Multi-MP Reliability cron |
| `search-metrics` | 38 | VALID: 5 MPs (no mvideo) |
| `telemetry-ingest` | 10 | mvideo in allowlist |
| `compare-research` | 23 | includes mvideo |
| `fetch-product-price` | 28 | mvideo cache/unlocker |
| `price-cache` | 19 | mvideo |
| `tracked-sync` | 44 | mvideo |
| `seo-publish` | 19 | mvideo allowlist |
| `seo-refresh-offers` | 8 | mvideo offers |

**Gap vs `/ops` UI:** Edge backend largely current; **landing** (`priceguard-landing`) redeploy is the usual blocker for new dashboard sections.

---

## Repo git vs prod

| Item | Status |
|------|--------|
| `origin/main` | At `c115d3e` — Mega tracked fix only |
| Local `main` | **+2 unpushed** (AliExpress READY) |
| MVIDEO-1…9 + multi-MP telemetry UI delta | **Uncommitted** working tree |
| Migration SQL files | On prod but **7 MP migrations untracked** in git |

**Action:** commit + push so repo matches prod; avoid duplicate MCP applies.

---

## Pending (MVIDEO-10)

| Migration (planned) | Purpose |
|---------------------|---------|
| `20260828110000_search_metrics_mvideo.sql` (name TBD) | CHECK widen `search_metrics` + `mvideo` |
| `20260828111000_search_success_rate_24h_mvideo.sql` (name TBD) | Add `mvideo` to `vw_search_success_rate_24h` |

See `MVIDEO10_TELEMETRY.md`.
