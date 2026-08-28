# STEP 8 — Telemetry audit (Megamarket)

**Date:** 2026-08-26  
**Scope:** Marketplace marking for Mega; URL/title/product PII vs existing rules; distinguishability of Mega errors vs CORE; browser/store labels.  
**Evidence:** code review (`funnel`, `ops`, `log`, `compare-mp-attempt`, `flush`, `telemetry-ingest`, `browser-label`, `store-config`) + unit tests — **36 passed** this session (`funnel`, `ops`, `redact`, `browser-label`, `store-config`, `ops-telemetry`).  
**No code changes.**

---

## Mega marketplace marking

| Channel | Mega id | Result |
|---------|---------|--------|
| Funnel allowlist | `COMPARISON_MARKETPLACE_IDS` → includes `megamarket` | Events keep `marketplace: 'megamarket'` |
| Ops allowlist (client + Edge `_shared/ops-telemetry`) | Explicit set includes `megamarket` | Search/scrape ops tagged Mega |
| `telemetry-ingest` `ALLOWED_MARKETPLACES` | Includes `megamarket` | Remote insert keeps label (not null) |
| Legacy `reportSearchMetric` / `search_metrics` | **Trio + Mega + Ali** (2026-08-27) | Reliability rows via `vw_search_metrics_*` |

**Verdict (updated 2026-08-27):** Funnel + ops + ingest correctly mark Mega. Legacy `search_metrics` now includes `megamarket` / `aliexpress` (same truncated query + URL-slice contract as CORE). Migration `20260827180000_search_metrics_mega_ali.sql`.

---

## Privacy (URL / title / product data)

### Funnel + ops (primary product analytics)

| Rule | Enforcement |
|------|-------------|
| No URL/title/reviews/emails/chat | Client `sanitizeFunnelData` + server `sanitizeFunnelPayload` / `sanitizeOpsPayload` |
| No `product_id` / `query_hash` on funnel/ops | `log.ts` clears them when `funnel` or `ops`; ingest forces `null` |
| Ops payload keys only | `source`, `path`, `context`, `reason`, `alert_type`, counts, `scrappey` |

Mega uses the **same** funnel/ops paths as CORE — no Mega-specific leak channel.

### Compared to CORE legacy path

`reportSearchMetric` sends truncated `searchQuery` (≤300) + `foundProductId` (URL slice ≤64 on Edge) for **trio + Mega + Ali** — same contract as CORE (no title / full browsing history).

### Residual (pre-existing, not Mega-specific)

| Item | Risk | Note |
|------|------|------|
| `COMPARE_MP_ATTEMPT` | Optional `productId` on non-funnel INFO | Call sites for Mega card/SERP usually omit `productId`; payload is `path`/`reason` only |
| Non-funnel WARN/ERROR | May carry `productId`, truncated `errorMessage`, loosely redacted `data` | Same for all MPs when remote opt-in |
| Local ring | Fuller events locally | Expected; remote opt-in gated |
| Ingest flush | Does **not** currently send `browser` field | Pre-existing; labels still correct locally |

**Unexpected Mega PII leakage:** **No** beyond existing non-funnel diagnostic rules.

---

## Mega errors vs CORE (distinguishability)

| Signal | Mega vs CORE |
|--------|----------------|
| `marketplace = 'megamarket'` | Distinct from `wildberries` / `ozon` / `yandex_market` |
| Ops `marketplace_search_failed` + `errorCode` / `reason` | e.g. `search_failed`, serp reasons — filterable by MP |
| Ops `scrape_request` / cache hit-miss | `marketplace` + `source` (`tab` for Mega; Scrappey gated off) |
| Funnel `comparison_failed` / `failure_reason` | Enum reasons + marketplace string |
| Legacy `search_metrics` | Mega/Ali included → Reliability dashboard + ops `telemetry_events` |

**Verdict:** Mega failures are filterable and not conflated with CORE in allowlisted remote events.

---

## Browser / store labels

| Component | Behavior | Mega impact |
|-----------|----------|-------------|
| `browser-label.ts` | UA → `chrome` \| `edge` \| `yandex` \| `unknown` only | **None** — no marketplace input |
| `getBrowserLabel()` on every emit | Coarse enum on local events | Unchanged by Mega |
| `store-config` | Same UA tokens → install/review URLs; CWS fallback | Independent of Mega |
| Unit tests | Edge before Chrome; YaBrowser → yandex | **PASS** |

**Verdict:** Browser/store labels **not broken** by Mega.

---

## Test evidence (this session)

```text
vitest: funnel, ops, redact, browser-label, store-config, ops-telemetry
→ 6 files, 36 tests passed
```

---

## Gaps / P2 notes (do not block Step 8)

1. No dedicated unit asserting `allowedMarketplace('megamarket')` / ingest remaps — coverage is via registry + shared allowlists.  
2. ~~Mega invisible in legacy `search_metrics`~~ — **done 2026-08-27** (`SEARCH_METRICS_ALLOWED_MARKETPLACES` + DB CHECK widen).  
3. Live remote batch with Mega card open **not** exercised (automation antibot / load-extension blocked earlier).

---

## Verdicts (Step 8)

| Gate | Result |
|------|--------|
| Mega correctly labeled | **PASS** (funnel/ops/ingest) |
| No extra URL/title/product vs rules | **PASS** (funnel/ops); legacy search_metrics = same truncated contract as CORE |
| Unexpected PII leakage | **PASS** (none Mega-specific) |
| Mega errors ≠ CORE | **PASS** |
| Browser/store labels | **PASS** |

**TELEMETRY: PASS** (code + unit; live remote sample not verified).
