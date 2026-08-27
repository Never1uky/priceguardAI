# Phase 8 — Monitoring frequency & cost KPI

## Verdict

**Do not add user-configurable check intervals.** Current cadence is already cost-aware.  
`next_check_at` is **derived**, not a DB column.

## Intervals (server Telegram monitoring)

| Tier | Freshness gate | Cron tick | Effective scrape cadence (healthy SKU) |
|------|----------------|-----------|----------------------------------------|
| Free | **6 h** (`PRICE_FRESH_MS_FREE`) | every **6 h** (`0 */6 * * *`) | **~4 scrapes / day** max, usually **~4 / day** when stale each tick |
| Premium | **3 h** (`PRICE_FRESH_MS_PREMIUM`) | same 6 h cron | **~4 / day** from cron alone; Premium becomes stale mid-window but cron only wakes every 6h → still **~4 / day** unless a second trigger exists |

**Minimum interval (practical):** 6 h between cron runs (pg_cron). Soft gate can be 3 h (Premium) but without a denser cron that does not create more Scrappey.

**Default:** Free 6 h freshness + 6 h cron.

**Configurable by user?** **No** — not in settings UI / API. Only env knobs: concurrency, max groups, circuit threshold, SKU timeout.

### Derived `next_check_at`

```
next_check ≈ last_checked + effectivePriceFreshMs(base, consecutive_unavailable)
```

- Healthy: base = 3h Premium / 6h Free  
- Soft fail backoff: ×4 / ×12, cap 3 days  
- Cron scrapes only if `now >= next_check` for ≥1 subscriber in the SKU group

### Client backup (not Scrappey)

| | |
|--|--|
| Chrome alarm | `CHECK_INTERVAL_MINUTES` (periodic local check) |
| Server stale threshold | **8 h** (`SERVER_STALE_MS`) before client backup |
| Scrappey | **`skipUnlocker: true`** — no Scrappey cost |

## Too frequent?

| Path | Risk |
|------|------|
| Cron every 6h + freshness | OK |
| Premium 3h gate + 6h cron | Gate tighter than cron → no extra Scrappey from cron |
| Soft fail without `last_checked` | Was a burn vector — fixed Phase 7 |
| Interactive `/add`, unlocker | Extra, not continuous monitoring |

## Cost KPI: ₽ / active monitored product / month

Rate (from ops): **4 ₽ / 1000 Scrappey API calls** → **0.004 ₽ / call**.

Definitions:

- **Active monitored product** = unique `(marketplace, product_id)` with ≥1 Telegram subscriber (`deleted=false`, server_monitoring on). Coalesce → **1 scrape job / unique SKU / check**, not ×users.
- Optimistic: `request` succeeds (1 call).  
- Pessimistic: `request` + `browser` (2 calls). WB usually **0** Scrappey (card.wb.ru).

### Steady state (healthy Ozon/YM SKU)

Cron: **4 runs/day** × 30 ≈ **120 checks/month**.

| Scenario | Calls/check | Calls/mo | ₽/mo |
|----------|-------------|----------|------|
| Ozon/YM optimistic | 1 | 120 | **0.48** |
| Ozon/YM pessimistic | 2 | 240 | **0.96** |
| WB (card API) | 0 | 0 | **~0** |
| Cache hit (shared 6h) | 0 live | 0 | **~0** |

### Soft-fail backoff (lower cost)

After failures, effective interval stretches (×4 / ×12) → fewer scrapes / month than 120.

### Multi-user

10 users × same Ozon SKU → still **~0.48–0.96 ₽/mo for that SKU** (not ×10).

### Formula

```
₽/mo ≈ (checks_per_month × calls_per_check / 1000) × 4
checks_per_month ≈ 30 × 24 / effective_interval_hours
                 ≈ 120 when effective_interval_hours = 6
```

### KPI summary (target unit economics)

| KPI | Value |
|-----|--------|
| Unique Ozon/YM SKU / month (steady) | **≈ 0.5–1 ₽** |
| Unique WB SKU / month | **≈ 0 ₽** Scrappey |
| Cost scales with | **unique SKUs**, not users |

## Recommendation

- Keep cron **6 h**; do **not** shorten for UX.  
- Do **not** ship per-user interval UI (cost + complexity).  
- If Premium needs true 3 h Scrappey cadence later: add denser cron **only for Premium-stale groups**, with explicit cost budget — out of scope unless asked.

## Code refs

- `PRICE_FRESH_MS_*` — `supabase/functions/update-prices/index.ts`  
- Cron — `supabase/scripts/setup-update-prices-cron.sql` (`0 */6 * * *`)  
- Backoff — `update-prices-policy.ts` `unavailableFreshMsMultiplier`  
- Client — `src/background/index.ts` `SERVER_STALE_MS`, `skipUnlocker`
