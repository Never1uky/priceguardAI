# Ali / Mega — legacy search_metrics on Reliability

**Date:** 2026-08-27  
**Change:** `reportSearchMetric` + Edge `search-metrics` + DB CHECK now accept `megamarket` and `aliexpress` (same truncated query / URL-slice contract as CORE trio).

| Piece | Detail |
|-------|--------|
| Client | `src/lib/telemetry/flush.ts` → `SEARCH_METRICS_ALLOWED_MARKETPLACES` |
| Edge | `supabase/functions/search-metrics` `VALID_MARKETPLACES` |
| DB | `20260827180000_search_metrics_mega_ali.sql` |
| Views | `vw_search_metrics_daily` / `weekly` already `GROUP BY marketplace` — no filter change |
| Out of scope | Product Telegram, `monitoring_enabled`, `update-prices` |

MetricsDashboard / Reliability rows appear once compare searches emit metrics for those MPs.
