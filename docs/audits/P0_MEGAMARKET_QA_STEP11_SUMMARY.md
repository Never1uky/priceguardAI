# STEP 11 — Итог QA / Release (Megamarket P0)

**Date:** 2026-08-26  
**Artifact:** `C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.107(2).zip`  
**SHA-256:** `80B90913BB18BA589356C72B2A8F2BBBDF7701110A3CF07FDCAC76BBC8B3E090`  
**Version:** `0.9.107`  
**Scope:** Сводка шагов 1–8 (+ remediation DB/sync после Step 6). **Код в этом шаге не менялся.**

Источники:  
`P0_MEGAMARKET_QA_RELEASE_AUDIT.md`, `…_STEPS_2_3.md`, `…_STEP4_SCRAPPEY.md`, `…_STEP5_TELEGRAM.md`, `…_STEP6_DATABASE.md` (+ remediation note), `…_STEP7_EDGE_CASES.md`, `…_STEP8_TELEMETRY.md`.

**Prod re-check (Step 11):**  
`tracked_products` / `product_price_history` CHECK = trio + `megamarket`.  
`tracked-sync` `VALID_MARKETPLACES` includes `megamarket` (commit `4d5e18d`).  
`qa-preflight.mjs` resolves newest `priceguard-ai-v{version}*.zip` by mtime.

---

## Gate summary (current)

| Gate | Verdict |
|------|---------|
| **SCRAPPEY SAFE** | **YES** |
| **TELEGRAM SAFE** | **YES** |
| **CORE REGRESSION** | **PASS** (static + unit; live CORE smoke recommended) |
| **DATABASE** | **PASS** (P0 migrate + Edge allowlist applied; other trio CHECKs intentional) |
| **PRODUCTION ZIP** | **PASS** (structure/hygiene of `(2).zip`); live Load unpacked **not verified** |
| **Overall** | **NOT READY FOR NEXT MARKETPLACE** |

---

## P0 BLOCKER

*(open code/runtime blockers: **none** after DB remediation)*

Previously open (now **CLOSED** — do not re-fix):

| ID | Was | File / function | Status |
|----|-----|-----------------|--------|
| P0-DB-1 | Prod CHECK trio-only on `tracked_products` | migration `20260826140000_megamarket_tracked_check.sql` | **FIXED** — prod CHECK includes `megamarket` |
| P0-DB-2 | Migration not on prod | same | **FIXED** |
| P0-SYNC-1 | `VALID_MARKETPLACES` trio → silent skip Mega | `tracked-sync/index.ts` | **FIXED** + deployed |

---

## P1 HIGH

### P1-1 — Live install of production zip not verified

| | |
|--|--|
| **File** | N/A (process) / artifact `(2).zip` |
| **Function** | Manual: Load unpacked → popup → Settings |
| **Repro** | Unpack **only** `(2).zip` → Chrome Load unpacked → open popup + Settings |
| **Expected** | v0.9.107, no errors; Mega listed; Mega OFF; WB/Ozon/YM ON; persist after restart/reload |
| **Actual** | Automation: Chrome 151 `--load-extension` did not register extension; popup `ERR_FILE_NOT_FOUND`. Operator screenshots **not** attached |
| **Impact** | Cannot sign Step 2 install UX; blocks “READY FOR NEXT MARKETPLACE” |
| **Cause** | Environment/automation limits; manual QA not completed |
| **Minimal fix** | Operator checklist in Step 2–3 doc; screenshot Settings (Mega unchecked) |

### P1-2 — Live Mega card / SERP / compare smoke not executed

| | |
|--|--|
| **File** | `src/utils/parsers/megamarket.ts` (`parseMegamarketProduct`), SERP in `search-results.ts`, compare via `marketplace-search` / `compare-service` |
| **Function** | Live scrape + compare on real megamarket.ru |
| **Repro** | Load `(2).zip` → open `/catalog/details/…` → popup fields → opt-in Mega → compare; SERP page must **not** be card |
| **Expected** | Title, price, article, canonical host; Mega slot with details URL; SERP≠card; CORE slots OK |
| **Actual** | Antibot/blank in automation; unit fixtures PASS; **no live DOM evidence** |
| **Impact** | Cannot claim parse/SERP quality on production HTML; next MP premature |
| **Cause** | Mega antibot vs headless/CDP; no operator smoke |
| **Minimal fix** | Manual smoke on normal Chrome profile (checklist Step 3). Any empty parse on real card → escalate to **P0** |

### P1-3 — Live DOM/selector fragility (latent until smoke)

| | |
|--|--|
| **File** | `src/utils/parsers/megamarket.ts`, content `index.ts` Mega branch |
| **Function** | DOM + JSON-LD selectors |
| **Repro** | Open live Mega card after layout/antibot change |
| **Expected** | Non-null product with price or explicit OOS |
| **Actual** | Unknown live; unit DOM fixtures only |
| **Impact** | User-facing “empty Mega” while code looks green |
| **Cause** | Layout churn / antibot HTML |
| **Minimal fix** | Complete P1-2; if fail → fix selectors + fixtures from captured HTML (**only after approval**) |

### P1-4 — Ops risk: enabling Mega monitoring without cost RFC

| | |
|--|--|
| **File** | `marketplace_flags` / cost-guards / `update-prices` |
| **Function** | `monitoring_enabled`, Scrappey allowlists |
| **Repro** | Flip Mega `monitoring_enabled=true` **and** widen Scrappey/monitoring allowlists |
| **Expected** | Mega stays tab-only / monitoring off for P0 |
| **Actual** | Today SAFE; mistake could add cost |
| **Impact** | Scrappey/Telegram cost blow-up |
| **Cause** | Config + code gates are separate |
| **Minimal fix** | Policy: no Mega monitoring/Scrappey without RFC; alert if ops shows Mega + `source=scrappey` |

---

## P2 MEDIUM

### P2-1 — Multiple `0.9.107*.zip` siblings

| | |
|--|--|
| **File** | repo root zips |
| **Function** | Release discipline |
| **Repro** | List `priceguard-ai-v0.9.107.zip`, `(1).zip`, `(2).zip` — different SHA |
| **Expected** | One canonical artifact |
| **Actual** | Three; risk of loading wrong build |
| **Impact** | Wrong SHA in store / QA |
| **Cause** | Repeated `package:release` without archive |
| **Minimal fix** | Move old zips to `release/0.9.107/` archive; keep `(2).zip` as canonical for this Mega build |

### P2-2 — Manifest hosts/CS for non-READY MPs

| | |
|--|--|
| **File** | `manifest.json` (in zip) |
| **Function** | `host_permissions` / `content_scripts.matches` |
| **Repro** | Inspect zip manifest |
| **Expected** (honesty) | Permissions ≈ claimed READY support |
| **Actual** | Ali/MVideo/DNS/… hosts + CS; only Mega P0-hardened among extras |
| **Impact** | Store review / “host ≠ support” confusion |
| **Cause** | Multi-MP scaffold |
| **Minimal fix** | Listing/docs clarity; later gate CS (separate decision) |

### P2-3 — Mega card price=0 without OOS signal

| | |
|--|--|
| **File** | `src/utils/parsers/megamarket.ts` — `parseMegamarketProduct` |
| **Function** | Price + availability |
| **Repro** | Card with title, price 0, no OutOfStock / OOS phrases |
| **Expected** | Clear empty/not-priced vs OOS |
| **Actual** | `price: 0`, `availability: undefined` |
| **Impact** | Ambiguous UI / match |
| **Cause** | Soft parse path |
| **Minimal fix** | Treat price≤0 without OOS as scrape-empty sooner (approve before code) |

### P2-4 — Mega card allows empty `article`

| | |
|--|--|
| **File** | `src/utils/parsers/megamarket.ts`; SERP in `search-results.ts` |
| **Function** | Card id vs SERP article gate |
| **Repro** | Details-like URL without extractable digits |
| **Expected** | Strong identity or reject |
| **Actual** | SERP rejects; card may return `article: ''`, `id: megamarket:${url}` |
| **Impact** | Weak cache/match |
| **Cause** | Asymmetric SERP vs card strictness |
| **Minimal fix** | Require article for successful card parse (stricter) |

### P2-5 — Remaining trio-only DB CHECKs (non-P0 tables)

| | |
|--|--|
| **File** | e.g. `product_cache`, `search_metrics`, mapping/feedback/SEO tables |
| **Function** | CHECK constraints |
| **Repro** | INSERT Mega into those tables |
| **Expected** | N/A for P0 features off |
| **Actual** | Reject Mega |
| **Impact** | Soft fail if client hits `search_metrics` for Mega (client already skips Mega in `reportSearchMetric`); AI cache/mapping later |
| **Cause** | Intentional narrow P0 migrate |
| **Minimal fix** | Widen per feature RFC only |

### P2-6 — No Mega-specific timeout / malformed LD unit

| | |
|--|--|
| **File** | `megamarket.test.ts` (gap) |
| **Function** | Tab timeout / bad JSON-LD |
| **Repro** | Unit missing |
| **Expected** | Soft null/empty without throw |
| **Actual** | Covered implicitly by catch paths |
| **Impact** | Regression risk |
| **Minimal fix** | Add fixtures (malformed LD; assert no throw) |

### P2-7 — Automation cannot load MV3 via CLI on Chrome 151

| | |
|--|--|
| **File** | QA process / `scripts/qa-cdp-*.mjs` |
| **Function** | `--load-extension` |
| **Repro** | Headless/CDP load unpacked |
| **Expected** | Extension registered |
| **Actual** | Empty `extensions.settings` |
| **Impact** | CI E2E blocked |
| **Minimal fix** | Document manual Load unpacked; optional profile with pre-installed ext |

---

## P3 LOW

### P3-1 — `localhost` string inside minified supabase-js in zip

| | |
|--|--|
| **File** | zip `storage-*.js` (vendor) |
| **Function** | Default client strings |
| **Repro** | Grep zip for `localhost` |
| **Expected** | No prod localhost **wiring** |
| **Actual** | String present; not in manifest / `externally_connectable` |
| **Impact** | Noise for auditors |
| **Minimal fix** | None required; optional note in release FAQ |

### P3-2 — ~15 marketplace CHECKs per new MP

| | |
|--|--|
| **File** | Multiple migrations / constraints |
| **Function** | CHECK allowlists |
| **Impact** | Ops friction for next MP |
| **Minimal fix** | Doc enum strategy / shared domain type later |

### P3-3 — Telemetry: no dedicated Mega allowlist unit; `browser` not in ingest flush

| | |
|--|--|
| **File** | `src/lib/telemetry/flush.ts`, funnel tests |
| **Impact** | Low; Mega still labeled in funnel/ops/ingest |
| **Minimal fix** | Optional assert `allowedMarketplace('megamarket')`; optional send `browser` if product wants it |

### P3-4 — `search_metrics` Mega INSERT would fail if ever called

| | |
|--|--|
| **File** | `src/lib/telemetry/flush.ts` `reportSearchMetric` |
| **Function** | Early-return trio-only (already) |
| **Impact** | None while guard holds |
| **Minimal fix** | Keep guard; or widen CHECK if metrics needed |

---

## PASS (by area)

| Area | Evidence |
|------|----------|
| Zip MV3 / version / Mega hosts+CS | Step 1 static |
| Mega `enabledByDefault: false`; CORE default trio | Registry + `search-settings` tests |
| Unlocker / Scrappey allowlist trio only | Bundle + Step 4 |
| Mega → no auto Scrappey | Step 4 |
| Mega → no Telegram monitoring / cron scrape | Step 5 (`resolveMonitoringKey`, coalesce, flags) |
| SERP ≠ product card (unit) | `isProductPage`, parser, SERP article gate |
| Compare isolation (Mega throw ≠ abort others) | Step 7 `resolveTarget` / pool |
| Telemetry Mega label + privacy funnel/ops | Step 8 |
| Browser/store labels independent of Mega | `browser-label` / `store-config` tests |
| DB tracked + history Mega allowed (prod) | Step 11 SQL re-check |
| `tracked-sync` accepts Mega | Code + deploy |
| `qa-preflight` newest `(N).zip` | Script fix in repo |

---

## Verdicts

```
NOT READY FOR NEXT MARKETPLACE
```

**Why:** Safety gates (Scrappey / Telegram / defaults / DB track path) are solid, but **live Load unpacked + live Mega card/SERP/compare** on `(2).zip` were never completed. Next marketplace would multiply unverified live risk.

```
SCRAPPEY SAFE: YES
TELEGRAM SAFE: YES
CORE REGRESSION: PASS
DATABASE: PASS
PRODUCTION ZIP: PASS
```

Notes on gates:

- **CORE REGRESSION PASS** = static defaults + focused unit; recommend one live WB/Ozon SKU after Mega smoke.  
- **PRODUCTION ZIP PASS** = `(2).zip` structure/SHA/registry OK; install UI still needs P1-1. Sibling zips = P2 hygiene.  
- **DATABASE PASS** = P0 tracked path; remaining trio CHECKs = intentional P2.

---

## Минимальный набор исправлений (предложение — **не применять без approve**)

### Must before “READY FOR NEXT MARKETPLACE” (process, no code)

1. **P1-1 + P1-2:** Manual Load unpacked of **`(2).zip` only** + Mega card/SERP/compare + one CORE compare; attach screenshots / notes.  
2. **P2-1:** Archive older `0.9.107.zip` / `(1).zip` so only canonical Mega artifact remains in play.

### Optional code (only if live smoke fails or you want hardening)

3. **If live parse empty (→ escalate P0):** Fix Mega selectors/fixtures from captured HTML.  
4. **P2-3 / P2-4:** Stricter empty-price / require article on card (product call).  
5. **P2-6:** Unit fixtures malformed LD.  
6. **Do not** enable Mega `monitoring_enabled` or Scrappey without RFC (P1-4).  
7. **Do not** widen non-P0 DB CHECKs in the same change.

### Already done (no action)

- Prod CHECK Mega on tracked/history  
- `tracked-sync` Mega allowlist + deploy  
- `qa-preflight` newest zip resolve  

---

## Decision ask

После ручного smoke (п.1–2): если всё зелёное → можно пересмотреть verdict на **READY FOR NEXT MARKETPLACE**.  
Если live parse/SERP сломан → сначала фикс Mega (approve), не следующий MP.

**Код сейчас не трогаю** — жду approve на минимальный набор.
