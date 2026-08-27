# STEP 5 — Telegram regression (Megamarket monitoring_enabled=false)

**Date:** 2026-08-26  
**Assumption:** `marketplace_flags.megamarket.monitoring_enabled = false` (seed + P0 ops).  
**No code changes.** Unit evidence: flags / monitoring-key / coalesce / cost-guards — **22 passed**.

---

## What “Telegram monitoring” means here

| Kind | Mega allowed? |
|------|----------------|
| **Server monitoring** — `update-prices` cron → scrape → fan-out TG | **NO** |
| **Telegram `/add` → tracked + scrape** | **NO** (URL not parsed) |
| **Client local track/compare alert** via `price-alert-notify` after HB price | Possible if user tracked Mega locally — **no Scrappey / no cron job** |
| CORE WB/Ozon/YM server monitoring | **YES** (unchanged) |

---

## Requirement checklist

| Requirement | Result | Mechanism |
|-------------|--------|-----------|
| Mega not auto-added to Telegram monitoring | **PASS** | Flags + parse + coalesce |
| Mega does not create new scraping job in cron | **PASS** | Dropped before `fetchMarketplacePriceDetailed` |
| Mega does not increase marketplace checks in `update-prices` | **PASS** | Not in `groups` after coalesce + `isMonitoringAllowed` |
| Mega does not multiply Scrappey usage | **PASS** | See Step 4 + below |
| CORE WB/Ozon/YM keep working | **PASS** (code/unit) | Defaults monitoring on; coalesce + Scrappey allowlist trio |

---

## Path table

| PATH | Mega involved? | Enters TG monitoring scrape? | Scrappey? | CORE still works? | Notes |
|------|----------------|------------------------------|-----------|-------------------|-------|
| **Tracked product** — Telegram `/add` Mega URL | User pastes Mega | **No** | No | Yes | Edge `detectMarketplace` trio-only → «Не распознал» |
| **Tracked product** — extension sync Mega row (after CHECK migration) | Row may exist in DB | **No** cron scrape | No | Yes | `resolveMonitoringKey(megamarket)` → **null** → coalesce skips |
| **Price update** — server cron stale CORE | CORE only in groups | Yes (CORE) | Maybe (Premium tier) | Yes | Unchanged |
| **Price update** — server cron Mega row in workQueue | In raw queue if synced | **Filtered out** | No | Yes | Double gate below |
| **Telegram alert** — cron price-drop / target | Mega | **No** (never scraped) | No | Yes | No fan-out without fetch |
| **Telegram alert** — client `dispatchPriceDropAlert` after local Mega HB refresh | Optional | N/A (notify only) | No | Yes | Not a monitoring job |
| **Periodic update** — client `checkAllTrackedPrices` / compare backup | Mega local | No Scrappey | No | Yes | `skipUnlocker: true` on tracked |
| **Server `update-prices`** | Mega in DB | **No group** | No | Yes | See gates |
| **Refresh tracked** — client | Mega | HB only | No | Yes | |

---

## Gate stack (Mega cannot become a scrape job)

```text
tracked_products row marketplace='megamarket'
        │
        ▼
workQueue (all user rows, incl. Mega if present)
        │
        ▼
coalesceTrackedSkuGroups()
  └─ resolveMonitoringKey()
       └─ isCoreMonitoringMarketplace('megamarket') === false
       └─ return null  →  ROW DROPPED (no SkuMonitorGroup)
        │
        ▼  (even if somehow grouped)
.filter(g => isMonitoringAllowed(mpFlags, g.marketplace, costGuards.monitoringMarketplaces))
  └─ flags.megamarket.monitoringEnabled === false  →  false
  └─ globalAllowlist = CORE only  →  Mega excluded even if flag flipped alone
        │
        ▼
processGroup → scraperForMarketplace / fetchMarketplacePriceDetailed
  └─ Never reached for Mega
```

**Telegram `/add` earlier gate:**

```text
parseProductLinkFromText(megaUrl) → null  (detectMarketplace Edge = trio)
→ no upsert as monitored Mega from bot
→ isMonitoringAllowed never evaluated for Mega from /add
```

---

## Does Mega increase `update-prices` check count?

| Metric | Effect of Mega rows in DB |
|--------|---------------------------|
| `stats.products` (workQueue length) | May **count** Mega rows (pre-coalesce) |
| `groups` / `processedGroups` / `stats.checked` | **Unchanged** — Mega never becomes a group |
| Scrappey calls | **Unchanged** |

**P3 note:** `stats.products` can look higher if many Mega local-sync rows exist, but **no scrape**. Optional future: exclude non-core from workQueue earlier for cleaner metrics — not required for cost safety.

---

## CORE regression (WB / Ozon / YM)

| Control | Status |
|---------|--------|
| Default flags: CORE `monitoring_enabled=true` | Unit PASS |
| `resolveMonitoringKey` Ozon/WB/YM | Unit PASS |
| Coalesce same-SKU multi-user | Unit PASS |
| `cost-guards` scrappey/monitoring allowlists default CORE | Unit PASS |
| `fetchMarketplacePriceDetailed` implements trio | Code |
| Telegram `/add` help text lists WB/Ozon/YM | Code |

Live cron smoke on prod not run in this session — **code/unit PASS**; recommend one prod cron dry-run metrics check when convenient.

---

## Findings by severity

### P0 BLOCKER
None for Mega→Telegram monitoring / Scrappey under `monitoring_enabled=false`.

### P1 HIGH
None code-level. **Ops:** keep Mega `monitoring_enabled=false`; do not add Mega to `monitoring_marketplaces` / `scrappey_marketplaces`.

### P2 MEDIUM

| | |
|--|--|
| **Title** | Client may still send TG **notify** for locally tracked Mega price drops |
| **File** | `src/background/index.ts` `checkTrackedProduct` → `dispatchPriceDropAlert` |
| **Expected (strict reading of “no Telegram”)** | Some PMs may want zero Mega TG messages |
| **Actual** | Notify path is MP-agnostic; uses price already from HB — **not** monitoring scrape |
| **Impact** | User confusion vs cost — **$0 Scrappey** |
| **Minimal fix (optional)** | Gate client TG alerts: skip if `!isPremiumUnlockerMarketplace` / server monitoring flag — **only if product wants silence** |

### P3 LOW

| | |
|--|--|
| **Title** | Mega rows inflate `stats.products` before coalesce |
| **Minimal fix** | Filter non-core out of workQueue early (metrics hygiene) |

---

## Unit evidence (this step)

```
marketplace-flags.test.ts     4 passed  (Mega monitoring false; compare-only)
monitoring-key.test.ts        2 passed  (CORE keys)
update-prices-coalesce.test.ts 11 passed (CORE coalesce; non-title keys)
cost-guards.test.ts           5 passed  (Scrappey allowlist CORE)
Total: 22 passed
```

Explicit Mega coalesce drop is implied by `resolveMonitoringKey` + `isCoreMonitoringMarketplace` (Mega ∉ CORE → null). Not a separate named test — **P3** add `expect(resolveMonitoringKey({marketplace:'megamarket',...})).toBeNull()` if desired.

---

## Verdicts (Step 5)

| Gate | Result |
|------|--------|
| **TELEGRAM SAFE** (Mega monitoring) | **YES** |
| **SCRAPPEY SAFE** (via Telegram/cron) | **YES** |
| **CORE Telegram monitoring regression** | **PASS** (unit/code) |
| **Live prod cron** | Not executed this session |

### Overall Step 5

**PASS for Mega monitoring isolation** under current flags/code.

Still **NOT READY FOR NEXT MARKETPLACE** overall QA (Steps 2–3 live install/smoke pending; Step 1 preflight zip mismatch; DB migrate apply unverified) — but **Telegram/Scrappey monitoring gates for Mega are solid**.
