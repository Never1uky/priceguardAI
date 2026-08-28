# Multi-MP search success alerts (ops Reliability)

**Date:** 2026-08-27  
**Scope:** Ops cron `search-alerts` + MetricsDashboard Reliability 24h — WB/Ozon/YM/Mega/Ali.  
**Not in scope:** Product Telegram (detect / `/add` / user price alerts), `monitoring_enabled`.

## Pieces

| Piece | Detail |
|-------|--------|
| View | `vw_search_success_rate_24h` — one row per MP (zeros if no traffic) |
| Alias | `vw_wb_success_rate_24h` — WB-only columns (compat) |
| Logic | `_shared/search-success-alerts.ts` |
| Cron | `search-alerts` — alert if any MP has `total >= 5` AND `rate < threshold` |
| Threshold | `SEARCH_SUCCESS_RATE_ALERT_THRESHOLD` → else `WB_SUCCESS_RATE_ALERT_THRESHOLD` → else `85` |
| Dashboard | `searchSuccessRate24h[]` + multi-MP banner |

Migration: `20260827181000_search_success_rate_24h_multi_mp.sql`
