# QA Steps 2–3 — Install + MegaMarket user scenario

**Date:** 2026-08-26  
**Artifact:** `priceguard-ai-v0.9.107(2).zip` (SHA `80B909…E090`)  
**Also verified unpacked at:** `%TEMP%\pg-qa-unpacked-0107` (= extract of that zip)  
**Matching dist:** `C:\Users\sj480\Projects\priceguard-ai\dist` (same build as package:release)

**Code was not changed for product features.** Temporary CDP helper scripts under `scripts/qa-cdp-*.mjs` were used for install probing only.

---

## Automation status

| Attempt | Result |
|---------|--------|
| Cursor `user-chrome-devtools` → megamarket.ru | Blank white page / timeout (antibot or incomplete render) |
| Chrome 151 `--load-extension` + `--enable-unsafe-extension-debugging` + remote debugging | Profile created; **extension not persisted** in Preferences (`extensions.settings` empty / no unpack path). Popup navigate → `ERR_FILE_NOT_FOUND` for guessed ID |
| CDP open megamarket search | Redirected to brand hub; not usable for SERP scrape QA |

**Conclusion:** Automated “install as normal user + popup/settings UI + live Mega card” **blocked** in this environment. Remaining Step 2–3 coverage = **static evidence from production zip** + **unit tests** + **exact manual checklist** for the operator.

---

## STEP 2 — Installation

### Manual steps (operator — use these)

1. Unpack **only**  
   `C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.107(2).zip`  
   to a stable folder, e.g. `C:\Users\sj480\Desktop\pg-0.9.107-mega\`  
   (Do **not** use older `0.9.107.zip` / `(1).zip` — different SHA.)
2. Chrome → `chrome://extensions` → Developer mode ON → **Load unpacked** → select that folder.
3. Confirm card: name **PriceGuard AI**, version **0.9.107**, no red errors.
4. Click extension icon → popup opens.
5. Open **Settings** (gear / вкладка настроек).
6. Section **«Где искать товары»**:
   - See **Мегамаркет / Мега** in the list.
   - Checkboxes: **WB, Ozon, Я.Маркет ON**; **Мега OFF**.
7. Close Chrome fully → reopen → Settings again → same selection (persist).
8. Reload extension on `chrome://extensions` → Settings still sane (no empty selection; trio restored if corrupt).

### Static / automated evidence (this session)

| # | Check | Result | Evidence |
|---|--------|--------|----------|
| 1 | Install without errors | **BLOCKED (auto)** / manual required | Chrome 151 CLI load did not register extension |
| 2 | Popup opens | **BLOCKED (auto)** | — |
| 3 | Settings open | **BLOCKED (auto)** | — |
| 4 | Mega listed | **PASS (static)** | Unpacked `storage-*.js` registry includes `id:"megamarket"`; Settings maps `MARKETPLACES` |
| 5 | Mega not selected by default | **PASS (static+unit)** | `enabledByDefault:!1`; `search-settings` test «defaults to WB+Ozon+YM (no megamarket)» |
| 6 | CORE trio selected by default | **PASS (static+unit)** | `enabledByDefault:!0` for wb/ozon/ym; same test |
| 7 | Persist after browser restart | **PASS (code path)** / live **BLOCKED** | `chrome.storage.local` key `priceguard_search_marketplaces_v1` |
| 8 | Reload / migration doesn’t break | **PASS (unit)** / live **BLOCKED** | `normalizeSearchMarketplaces` empty→trio; legacy id migrate |

### Step 2 findings

#### P1 HIGH

| | |
|--|--|
| **Title** | Live install of production zip not verified in automation |
| **Impact** | Cannot sign Step 2 items 1–3, 7–8 live |
| **Minimal fix** | Operator runs manual steps above; attach screenshot of Settings with Mega unchecked |

#### P2 MEDIUM

| | |
|--|--|
| **Title** | Chrome 151 may ignore `--load-extension` for QA automation |
| **Impact** | CI cannot auto-load unpacked MV3 without UI |
| **Minimal fix** | Document manual Load unpacked; optional Playwright with user-data that already has extension |

#### PASS (static)

Defaults and registry in **`(2).zip`** match product rules (Mega opt-in, CORE default).

---

## STEP 3 — MegaMarket user scenario

### Manual scenario (operator)

**Prep:** Load unpacked `(2).zip`. In Settings enable Mega **only if** server `marketplace_enabled=true` (else UI may show «на сервере выкл»). Keep `monitoring_enabled=false`.

| # | Action | Expected |
|---|--------|----------|
| 1 | Open real Mega **card** URL matching `/catalog/details/…{digits}…` | Page loads for user |
| 2 | Open popup | Product / compare UI |
| 3 | Marketplace | Detected as **megamarket** (not WB/Ozon/YM) |
| 4 | Fields | title; brand in title if LD brand; price RUB; availability/OOS; seller in specs if present; canonical `megamarket.ru` (sber rewritten); article digits |
| 5 | Run compare with Mega **unchecked** | Mega **absent** from results |
| 5b | Opt-in Mega + compare | Mega slot appears; search via tab/SERP |
| 6 | Mega in results | Offer URL is `/catalog/details/…`, **not** `/catalog/?q=` |
| 7 | Manual pick | CandidatePicker / paste Mega details URL works |
| 8 | Wrong card | Reject / weak match / needs_choice — not silent wrong bind |
| 9 | Catalog/SERP page | **Not** treated as product card (`isProductPage` false; scrape null) |
| 10 | Details-like URL without article digits | No candidate / empty article — not fake product |
| 11 | Multi-seller | Best-effort seller in specs; price still parses |
| 12 | Missing/OOS | `out_of_stock` or price 0; no false in_stock |

### Evidence this session (no live Mega DOM)

| # | Result | Evidence |
|---|--------|----------|
| 1–2 live | **BLOCKED** | Antibot / blank in automation browsers |
| 3 detect | **PASS (unit)** | `detectMarketplace` mega + sber hosts |
| 4 fields | **PASS (unit fixtures)** | `megamarket.test.ts` JSON-LD brand/price/sku/OOS/seller; live **BLOCKED** |
| 5–6 compare slot | **PASS (unit)** | `compare-offers.marketplaces.test.ts`; live **BLOCKED** |
| 7 manual | **PASS (code path)** | Shared CandidatePicker; live **BLOCKED** |
| 8 wrong card | **PARTIAL** | Matching engine tests; Mega-specific live **BLOCKED** |
| 9 SERP ≠ card | **PASS (unit)** | `isProductPage` false for `catalog/?q=`; `parseMegamarketProduct` null on non-details; SERP scrape rejects non-details |
| 10 bad article | **PASS (unit)** | SERP skips links without extractable article |
| 11 multi-seller | **BLOCKED live** | Seller helper unit only |
| 12 OOS | **PASS (unit)** | schema.org OutOfStock → price 0 + `out_of_stock` |

### Step 3 findings

#### P0 BLOCKER

*(none proven in code against fixtures)*

#### P1 HIGH

| | |
|--|--|
| **Title** | Live Mega card/SERP/compare on production artifact not executed |
| **File** | N/A (process) |
| **Repro** | Load `(2).zip` → open real Mega details + SERP |
| **Expected** | Fields + SERP candidates + no SERP-as-card |
| **Actual** | Automation blank/redirect; no operator screenshots yet |
| **Impact** | Cannot claim Step 3 READY |
| **Minimal fix** | Complete manual table above; note any selector failures as P0 if parse returns empty on real card |

#### P2 MEDIUM

| | |
|--|--|
| **Title** | Mega live may require normal user Chrome (not headless/CDP) due to antibot |
| **Impact** | Automated E2E fragile |
| **Minimal fix** | Manual QA on personal Chrome profile |

---

## SERP vs product card (critical)

| Check | Status |
|-------|--------|
| Product page = `/catalog/details/` | Adapter + tests **PASS** |
| Search `catalog/?q=` is **not** product | Tests **PASS** |
| SERP candidates require details + article | Tests **PASS** |
| Search URL never stored as offer product URL (happy path) | Code path **PASS**; live confirm **pending** |

---

## Updated gate summary (after Steps 2–3)

| Gate | Verdict |
|------|---------|
| **SCRAPPEY SAFE** | **YES** (unchanged) |
| **TELEGRAM SAFE** | **YES** (unchanged) |
| **CORE REGRESSION** | **PASS static/unit**; live CORE smoke still recommended |
| **DATABASE** | **FAIL** until migration applied (unchanged) |
| **PRODUCTION ZIP** | Structure **PASS**; install UI **not live-verified** |
| **STEP 2 INSTALL** | **NOT LIVE-VERIFIED** |
| **STEP 3 MEGA UX** | **NOT LIVE-VERIFIED** (unit coverage strong for detect/parse/SERP≠card) |

### Overall (still)

# NOT READY FOR NEXT MARKETPLACE

Blocked on: **manual Load unpacked + live Mega smoke**, preflight zip mismatch (Step 1), DB migrate apply.

---

## Operator checklist (copy/paste)

```
[ ] Unpack ONLY priceguard-ai-v0.9.107(2).zip
[ ] Load unpacked → v0.9.107, no errors
[ ] Popup opens
[ ] Settings → Mega visible, UNCHECKED; WB/Ozon/YM CHECKED
[ ] Restart Chrome → same
[ ] Reload extension → selection intact / defaults if empty
[ ] Mega card: title, price, article, canonical, OOS/seller if present
[ ] Compare Mega OFF → no Mega row
[ ] Mega ON (+ server flag) → Mega row; URL is /catalog/details/
[ ] SERP page: extension does NOT treat as product card
[ ] Paste bad URL without article → no false product
[ ] One WB + one Ozon compare still OK
```
