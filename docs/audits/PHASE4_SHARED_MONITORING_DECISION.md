# Phase 4 — Shared monitoring model decision

**Decision: do not rewrite schema.** Prefer the PRODUCT → Subscription mental model; the current stack already implements its **cost-critical path** without separate tables.

## Preferred model (target mental model)

```
TrackedProduct (shared)          Subscription (per user)
─────────────────────            ───────────────────────
marketplace                      user_id
product_id                       tracked_product_id
canonical_url                    telegram_chat_id (via settings)
last_price                       alert thresholds
last_checked_at
next_check_at
status
```

Flow: **PRODUCT → MONITORING JOB → SCRAPE → PRICE → MULTIPLE USERS**

## Current model (what we ship)

```
tracked_products                 user_alert_settings
(per user, denormalized)         (per user)
─────────────────────────        ──────────────────
user_id                          telegram_chat_id
marketplace                      min_drop_*, notifications_*
product_id (bare)                server_monitoring
product_url
last_price / last_checked
… alert cooldown fields
```

Plus shared scrape state:

```
price_scrape_cache               update-prices coalesce
(marketplace, product_id)        one group = one scrape job
price, url, fetched_at           fan-out → N tracked_products rows
```

## Equivalence map

| Preferred concept | Current artifact |
|-------------------|------------------|
| TrackedProduct identity | `(marketplace, bare product_id)` |
| TrackedProduct.last_price / last_checked | `price_scrape_cache` + denormalized copy on each `tracked_products` row after fan-out |
| TrackedProduct.next_check_at | Derived: Premium 3h / Free 6h freshness + OOS backoff (`isPriceRowStale`); scrape if **any** subscriber stale |
| TrackedProduct.status | `last_fetch_ok` / `last_fetch_error` / OOS counters (per row; group skips when all fresh) |
| Subscription | `tracked_products` row + `user_alert_settings` |
| MONITORING JOB | Cron `update-prices` + `coalesceTrackedSkuGroups` + lock |
| SCRAPE once | `fetchMarketplacePriceDetailed` per group |
| Fan-out | Loop over `group.rows` → update + Telegram per thresholds |

Runtime graph (already true):

```
PRODUCT key (mp:id)
   ↓
MONITORING JOB (coalesced group)
   ↓
SCRAPE (≤1 live call if stale; else cache)
   ↓
PRICE RESULT
   ↓
MULTIPLE USERS (tracked_products rows)
```

Not:

```
USER → SCRAPE → USER   ❌ (avoided by coalesce)
```

## Why not migrate to PRODUCT + Subscription tables now

1. **Invariant already held** for Scrappey cost (Phase 3 hardened bare-id coalesce + cache).
2. Migration would touch: RLS, tracked-sync, Telegram `/add`, Chrome sync, price history, claim-device, digests — high blast radius.
3. Denormalized `last_price` per user is useful for per-user grace/cooldowns and offline UI without joins.
4. User rule for this phase: *if existing architecture already solves it differently — do not rewrite without necessity.*

## When a real PRODUCT table would be justified

Revisit only if one of these becomes true:

- Need a single `next_check_at` queue / worker outside coalesce-in-cron
- Cross-product analytics or admin “who watches SKU X” without scanning `tracked_products`
- Persistent shared `status` independent of any subscriber (orphan monitoring)

Until then: keep **logical** shared product = coalesce key + `price_scrape_cache`; **physical** subscription = `tracked_products`.

## Phase 4 deliverable

- This decision record (no DDL, no dual-write layer).
- Code path of record: `supabase/functions/_shared/update-prices-coalesce.ts` + `update-prices/index.ts`.
- Phase 3 doc remains the operational hardening notes.

**Status: DONE — architecture accepted as equivalent; rewrite deferred.**
