# Phase 7 — Retry / failure (Telegram price monitoring)

## Verdict

Alerts only on **successful positive price**. Soft failures apply **cooldown + failure counter** (no false drop). Scrappey capped: **≤1 browser fallback**, skip on timeout/5xx; run-level **circuit** after 8 soft fails.

## Failure matrix

| Case | Behavior | Alert? | Next scrape |
|------|----------|--------|-------------|
| HTTP 502 / 5xx Scrappey | request only (no browser) | No | Soft backoff |
| Timeout | soft fail + `last_checked` | No | Soft backoff (was: every cron — **fixed**) |
| Captcha / still_blocked | request→browser once; then null | No | Soft backoff |
| Scrappey failure / null price | soft fail, keep `last_price` | No | Soft backoff ×1→×4→×12 (cap 3d) |
| Marketplace unavailable / OOS | same counter | No | Soft backoff |
| Product deleted / not found | usually null price → soft | No | Soft backoff |
| Identity mismatch | soft fail + cooldown | No | Soft backoff |
| Real price drop | update + Telegram | **Yes** | Reset counter |

## Protections

| Control | Where |
|---------|--------|
| Max Scrappey modes | `fetchViaScrappey`: request → optional **one** browser |
| No browser on timeout/5xx | `scrappey.ts` |
| Max URLs / unlocker | `fetchViaUnlocker`: ≤2 URL candidates |
| Per-SKU timeout | `raceWithTimeout` ~22s |
| Exponential-ish cooldown | `unavailableFreshMsMultiplier` via `consecutive_unavailable_count` |
| Soft fail patch | `softFailureTrackedPatch` — sets `last_checked`, never clears `last_price` |
| Run circuit breaker | after 8 soft fails → remaining groups skip Scrappey (`UPDATE_PRICES_SCRAPPEY_CIRCUIT_AFTER`) |
| Cron lock | no overlapping double-runs |

## Not infinite

```
502 → (optional browser skipped) → soft fail → last_checked
  → next cron: not stale until backoff expires
  → after 8 fails in one run: circuit open, no more Scrappey that run
```

## Code

- `supabase/functions/_shared/update-prices-failure.ts`
- `supabase/functions/update-prices/index.ts`
- `supabase/functions/_shared/scrappey.ts`

## Deploy

Redeploy Edge `update-prices` (and scrappey consumers if desired).
