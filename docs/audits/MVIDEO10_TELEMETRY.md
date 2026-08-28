# MVIDEO-10 — Telemetry / ops Reliability for М.Видео

**Date:** 2026-08-28  
**Follows:** MVIDEO-9 READY (`MVIDEO_FULL_INTEGRATION_NO_TELEGRAM.md`)  
**Pattern:** Mega STEP8 + [`SEARCH_METRICS_MEGA_ALI.md`](./SEARCH_METRICS_MEGA_ALI.md) + [`SEARCH_SUCCESS_ALERTS_MULTI_MP.md`](./SEARCH_SUCCESS_ALERTS_MULTI_MP.md)  
**Out of scope:** Product Telegram, `monitoring_enabled`, `update-prices` cron, fake PII in funnel/ops.

---

## Goal

M.Video appears in **legacy Reliability** (`search_metrics` + `/ops` Reliability 24h + `search-alerts` cron) with the **same truncated query / URL-slice contract** as CORE trio + Mega + Ali.

Funnel + ops ingest **already** accept `marketplace: 'mvideo'` (MVIDEO-1…2 registry + Phase 11 migration). Gap is **`reportSearchMetric` / DB CHECK / 24h view** only.

---

## Current vs target

| Channel | Today (MVIDEO-9) | After MVIDEO-10 |
|---------|------------------|-----------------|
| Funnel `COMPARISON_MARKETPLACE_IDS` | ✓ mvideo | ✓ |
| Ops `_shared/ops-telemetry` allowlist | ✓ mvideo | ✓ |
| `telemetry-ingest` ALLOWED | ✓ mvideo | ✓ |
| `reportSearchMetric` / `search-metrics` Edge | ✗ drops mvideo | ✓ insert |
| `search_metrics` DB CHECK | ✗ 5 MPs | ✓ + mvideo |
| `vw_search_success_rate_24h` | ✗ 5 MPs | ✓ + mvideo (zero row if no traffic) |
| `SEARCH_SUCCESS_ALERT_MARKETPLACES` | ✗ 5 MPs | ✓ + mvideo |
| `/ops` Reliability table | no mvideo row | row `mvideo` |
| `npm run test:mvideo` | no telemetry assert | + parity lines |

---

## Phase tasks

| # | Task | Primary files |
|---|------|---------------|
| 1 | Widen client allowlist | `src/lib/telemetry/flush.ts` → add `'mvideo'` to `SEARCH_METRICS_ALLOWED_MARKETPLACES` |
| 2 | Edge VALID sync | `supabase/functions/search-metrics/index.ts` `VALID_MARKETPLACES` |
| 3 | DB CHECK | Migration `20260828110000_search_metrics_mvideo.sql` — `search_metrics_marketplace_check` + comment |
| 4 | 24h view | Migration `20260828111000_search_success_rate_24h_mvideo.sql` — extend `unnest` + `WHERE IN` (+ alias `vw_wb_success_rate_24h` unchanged) |
| 5 | Ops alerts | `supabase/functions/_shared/search-success-alerts.ts` → `SEARCH_SUCCESS_ALERT_MARKETPLACES` |
| 6 | Tests | `src/lib/telemetry/flush.test.ts`, `supabase/functions/_shared/search-success-alerts.test.ts`, `src/lib/mvideo-core-parity.regression.test.ts` (Reliability row), optional `ops-telemetry.test.ts` assert unchanged |
| 7 | Docs | `docs/TELEMETRY.md`, `P0_MEGAMARKET_QA_STEP8_TELEMETRY.md` addendum (M.Video row), `MVIDEO_FULL_INTEGRATION` phase table |
| 8 | Deploy | Migration MCP/CLI + `search-metrics`, `metrics-dashboard`, `search-alerts` redeploy |
| 9 | Landing | Sync `/ops` if copy-only (no UI change — table auto-grows) |

**No change** to `monitoring-key.ts`, `cost-guards` MONITORING_ALLOWED, Telegram bots.

---

## Migration sketch (CHECK)

```sql
alter table public.search_metrics
  drop constraint if exists search_metrics_marketplace_check;

alter table public.search_metrics
  add constraint search_metrics_marketplace_check check (
    marketplace in (
      'wildberries', 'ozon', 'yandex_market',
      'megamarket', 'aliexpress', 'mvideo'
    )
  );

comment on constraint search_metrics_marketplace_check on public.search_metrics is
  'CORE trio + megamarket + aliexpress + mvideo for Reliability. Not Telegram / monitoring.';
```

View: copy `20260827181000_search_success_rate_24h_multi_mp.sql` pattern — add `'mvideo'::text` to `mps` array and both `IN` lists.

---

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
# 1. Migrations (after files committed)
npx supabase db push --project-ref ihlfvpocwobvcpxbypsd
# or MCP apply_migration ×2

# 2. Edge
npx supabase functions deploy search-metrics metrics-dashboard search-alerts --project-ref ihlfvpocwobvcpxbypsd
```

No extension **code** change beyond already shipping mvideo compare — but **Reliability rows appear only when** clients run a build that calls `reportSearchMetric` for mvideo FINAL_RESULT (same as Mega/Ali rollout).

---

## Verify

1. Unit: `npm run test:mvideo` + flush/search-success-alerts tests green.  
2. Extension 0.9.14x: compare with mvideo selected → network `search-metrics` POST `marketplace: "mvideo"`.  
3. SQL: `SELECT marketplace, count(*) FROM search_metrics WHERE created_at > now() - interval '1 day' GROUP BY 1` includes mvideo after smoke.  
4. `/ops`: seventh row `mvideo` in **Reliability — поиск 24h** (may be `0/0` until traffic).  
5. `search-alerts` cron: low mvideo rate triggers ops Telegram (not product MP alerts).  

---

## Privacy / contract (same as Mega/Ali)

| Field | Rule |
|-------|------|
| `searchQuery` | Truncated ≤300 client-side |
| `foundProductId` | URL slice ≤64 on Edge — no title |
| Funnel / ops | No URL/title/product_id — unchanged |

---

## Regression pack update

Add to `npm run test:mvideo`:

- `src/lib/telemetry/flush.test.ts` (extend mvideo case → `isSearchMetricsMarketplace('mvideo') === true`)

Matrix in `mvideo-core-parity.regression.test.ts`:

```typescript
it('search_metrics allowlist includes mvideo (MVIDEO-10)', () => {
  expect(isSearchMetricsMarketplace('mvideo')).toBe(true);
});
```

---

## Status

| Phase | Status |
|-------|--------|
| MVIDEO-10 | **pending** — plan only |

**Next command:** «начинай MVIDEO-10»
