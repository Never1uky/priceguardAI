# Phase 13 — Free / Premium server enforcement

Free users must not create unbounded Scrappey monitoring jobs. Extension UI limits are UX only; **server is source of truth**.

## Limits (unchanged product numbers)

| | Free | Premium / trial |
|--|------|-----------------|
| Tracked products | **5** | **50** |
| Alerts | same as tracks | same as tracks |
| Freshness | 6h | 3h (cron still 6h) |
| Trial | — | **7 days** (`trial_claims`) |
| Unlocker Scrappey | no | yes (paid + trial) |

Cost guards: `monitoring_cost_guards` / env (`cost-guards.ts`).

## What was broken

| Path | Before | After |
|------|--------|-------|
| `tracked-sync` push | **No cap** — unlimited DB rows | Cap via `maxActiveTracks` + `TRACK_LIMIT` |
| Trial on server | Ignored (`user_premium` only) | `resolveUserPlanAccess` reads `trial_claims` |
| Telegram `/add` Scrappey | Always (within 5) | Scrappey only Premium/trial; Free = cache+legacy |
| `runProductIntel` Scrappey | Always | Scrappey only if `isPremium` |
| Telegram «дешевле» | Scrappey for Free | Scrappey only Premium/trial |
| Cron priority/freshness | Paid only | Paid **or** active trial |
| `fetch-product-price` | Paid only | Paid **or** trial |

Cron already sliced to track limit (Phase 9) — that remains; now rows cannot grow unbounded via sync.

## Enforcement map

```
Extension UI 5/50          → UX
tracked-sync push          → SERVER CAP (Phase 13)
tracked-upsert maxActive   → SERVER CAP
Telegram /add              → SERVER CAP + Scrappey gate
update-prices              → slice + trial in premium set
fetch-product-price        → Premium/trial
product-intel / cheap      → Scrappey only Premium/trial
```

## Key modules

| File | Role |
|------|------|
| `_shared/premium-active.ts` | `resolveUserPlanAccess`, `planFromSources`, trial |
| `_shared/track-limit.ts` | `mayInsertTrackedProduct`, `resolveTrackLimitForUser` |
| `_shared/tracked-upsert.ts` | `maxActiveTracks` on insert/undelete |
| `tracked-sync` | Enforce cap on push |
| `telegram-webhook` | Cap + Scrappey gate |
| `update-prices` | Trial → Premium tier in cron |

## Alerts

No separate alert quota — one stream per tracked slot. Documented in `ALERT_PLAN`.

## AI Free 3/day

Still **client-enforced** + `ai-proxy` 40/h. Not Scrappey; P1 follow-up if needed.

## Tests

- `track-limit.test.ts` — insert/undelete/tombstone gates + trial plan
- Existing `premium-active.test.ts` for license rows

## Deploy

```bash
supabase functions deploy tracked-sync telegram-webhook update-prices fetch-product-price compare-research product-intel
```
