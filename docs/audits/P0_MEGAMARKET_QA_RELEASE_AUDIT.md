# QA / Release audit — Megamarket P0 production artifact

**Date:** 2026-08-26  
**Artifact under test:** `C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.107(2).zip`  
**SHA-256 (verified):** `80B90913BB18BA589356C72B2A8F2BBBDF7701110A3CF07FDCAC76BBC8B3E090`  
**Version in ZIP manifest:** `0.9.107`  
**Scope:** Static production-zip + safety-path review. **No code changes.** Live Chrome load of this zip on megamarket.ru was **not** executed in this pass.

---

## STEP 1 — Production artifact

### PASS

| Check | Result |
|-------|--------|
| ZIP exists, SHA matches claimed hash | Yes |
| `manifest_version` 3 | Yes |
| `version` 0.9.107 | Yes |
| Permissions: storage, notifications, alarms, scripting, webNavigation | Yes — no unexpected extras |
| Mega `host_permissions` | megamarket.ru + sbermegamarket.ru (+ www) |
| Mega `content_scripts.matches` | `/catalog/*` for mega + sber |
| Background SW | `service-worker-loader.js` type module |
| `externally_connectable` | only `https://priceguard-seo.vercel.app/*` |
| Localhost in **manifest** | **None** |
| Registry in bundle | `id:"megamarket"`, `enabledByDefault:!1`, `costTier:"tab"` |
| Unlocker allowlist in bundle | `["wildberries","ozon","yandex_market"]` only |
| Mega search stub / tab path | Present (`not_core`, Mega tab message) |
| Mega parser in content chunk | Present (`sbermegamarket` image selectors, details scrape) |
| `agentLog` in storage bundle | 0 hits |

### Localhost note (not a manifest leak)

`storage-*.js` contains supabase-js defaults (`http://localhost:9999`, hostname allowlist helpers). **Not** wired in production manifest / `externally_connectable`. Classify as **PASS / P3 noise**.

---

## Findings by severity

### P0 BLOCKER

*(none found in static Scrappey / Telegram / default-selection paths)*

---

### P1 HIGH

#### P1-1 — `qa:preflight` validated a **different** zip than the Mega P0 artifact

| | |
|--|--|
| **File** | `scripts/qa-preflight.mjs` |
| **Function** | zip resolve ≈ `priceguard-ai-v${version}.zip` (no `(N)` suffix) |
| **Repro** | After `package:release` → `(2).zip`; run `npm run qa:preflight` |
| **Expected** | Preflight checks the same SHA as release artifact |
| **Actual** | Preflight reported `priceguard-ai-v0.9.107.zip` (385386 B, SHA `90ECEC…`, dated 2026-08-25) — **not** `(2).zip` (385735 B, SHA `80B909…`, 2026-08-26) |
| **Impact** | False confidence: “preflight passed” does not certify Mega P0 package |
| **Cause** | Script only looks for exact `v{version}.zip`, ignores `(1)`/`(2)` copies |
| **Minimal fix** | Resolve newest matching `priceguard-ai-v{version}*.zip` by mtime (same as `validate-zip.mjs`), or require explicit `ZIP_PATH` |

#### P1-2 — Live Mega smoke on **this** zip not done

| | |
|--|--|
| **File** | N/A (process) |
| **Function** | Manual: load `(2).zip` → unpacked / Chrome → megamarket card + SERP compare |
| **Repro** | Required for “realistic production artifact” QA |
| **Expected** | Card title/price/id; SERP candidates; opt-in compare; CORE untouched |
| **Actual** | Only static + unit safety tests this session |
| **Impact** | Cannot sign off live parse/SERP/match quality |
| **Cause** | No Chrome load of artifact in this audit |
| **Minimal fix** | Ops checklist: load `(2).zip`, smoke Mega + one CORE SKU (see proposed list below). Do **not** ship next MP until done |

#### P1-3 — DB migration not verified on production

| | |
|--|--|
| **File** | `supabase/migrations/20260826140000_megamarket_tracked_check.sql` |
| **Function** | CHECK widen `tracked_products` / `product_price_history` |
| **Repro** | Track Mega product with cloud sync before migration applied |
| **Expected** | INSERT `marketplace='megamarket'` succeeds |
| **Actual** | Unknown on prod; without migrate → CHECK reject |
| **Impact** | Local track OK; cloud sync for Mega fails until migrate |
| **Cause** | Migration shipped in repo; apply is ops |
| **Minimal fix** | Apply migration; confirm `INSERT` smoke; keep `marketplace_flags.megamarket.monitoring_enabled=false` |

---

### P2 MEDIUM

#### P2-1 — ZIP grants host_permissions + CS for non-P0 MPs (Ali, MVideo, DNS, …)

| | |
|--|--|
| **File** | ZIP `manifest.json` |
| **Function** | `host_permissions` / `content_scripts.matches` |
| **Repro** | Inspect production manifest |
| **Expected** (product honesty) | Permissions ≈ claimed READY support |
| **Actual** | Many test MP hosts + CS inject; only Mega is P0-hardened |
| **Impact** | CWS/review / “host ≠ support” risk; CS runs on visits even if search off |
| **Cause** | Pre-existing multi-MP scaffold in same MV3 zip |
| **Minimal fix** | Doc/listing clarity; later: gate CS matches or defer hosts until READY (separate decision — **not** Mega-only) |

#### P2-2 — Multiple `0.9.107*.zip` siblings confuse release discipline

| | |
|--|--|
| **File** | repo root zips |
| **Repro** | Three files: `.zip`, `(1).zip`, `(2).zip` different SHA |
| **Expected** | One canonical release artifact |
| **Actual** | Three; docs/preflight can point at wrong one |
| **Impact** | Wrong build loaded in Chrome / stores |
| **Minimal fix** | Archive old zips out of root; preflight fix (P1-1); document canonical path = `(2).zip` for this Mega build |

---

### P3 LOW

#### P3-1 — supabase-js string `localhost` inside minified vendor

| | |
|--|--|
| **File** | `assets/storage-*.js` |
| **Expected** | No production localhost **endpoints** used |
| **Actual** | Library defaults only; manifest clean |
| **Impact** | Grep noise |
| **Minimal fix** | None required; optional allowlist in QA scripts |

#### P3-2 — User-truncated SHA abbreviated in chat

Claimed truncated hash matches full `80B909…E090` when verified. No issue.

---

## Safety path review (src + Edge + flags)

| Control | Status |
|---------|--------|
| `enabledByDefault: false` Mega | Bundle confirmed |
| Server seed Mega `marketplace_enabled=false`, `monitoring_enabled=false` | Migration `20260826003000` |
| Cost-guards `parseMpList` drops non-trio | Cannot put Mega in Scrappey/monitoring lists via env |
| Unlocker CORE-only | Bundle + `premium-unlocker-offer.ts` |
| Edge `Marketplace` / `detectMarketplace` | **Trio only** — Telegram cannot parse Mega URLs |
| `update-prices` / Telegram | `isMonitoringAllowed` + trio cost list |
| compare-research VALID | Trio only (Mega stripped) |
| Client Mega path | Tab / HiddenBrowser only |

Unit re-check this session: megamarket + unlocker + search-settings + compare-research-targets + cost-guards + marketplace-flags → **43 passed**.

---

## Verdicts

| Gate | Verdict |
|------|---------|
| **SCRAPPEY SAFE** | **YES** (static + guards; Mega not in unlocker/Scrappey allowlists) |
| **TELEGRAM SAFE** | **YES** (Edge does not detect Mega; monitoring flag seed false; cost-guards strip non-trio) |
| **CORE REGRESSION** | **PASS** (static defaults trio; focused tests green; **live CORE smoke still recommended**) |
| **DATABASE** | **FAIL\*** (migration file OK; **production apply not verified**) |
| **PRODUCTION ZIP** | **PASS** for packaging hygiene of `(2).zip` itself; **FAIL as “preflight-certified”** until P1-1 fixed / re-run on `(2).zip` |

\*Treat DATABASE as blocked for “Mega cloud track READY” until migrate applied; local-only compare still possible.

### Overall

# NOT READY FOR NEXT MARKETPLACE

Reasons: (1) live smoke of **`(2).zip`** on Mega + CORE not done; (2) preflight did not certify this artifact; (3) DB migrate apply unverified. Cost/Telegram static posture is good — do not expand MP surface until those gates close.

---

## Minimal fix set (proposed — **do not implement until approved**)

1. Fix `qa-preflight` zip resolution to newest `v{version}*.zip` (or explicit path).  
2. Re-run `node scripts/validate-zip.mjs` + preflight against **`(2).zip`**.  
3. Apply `20260826140000_megamarket_tracked_check.sql` on prod; keep Mega monitoring **false**.  
4. Manual smoke on loaded `(2).zip`:  
   - Settings: Mega off by default; CORE trio present  
   - Opt-in Mega only after flag enable (or staging flag)  
   - Mega card scrape; Mega SERP candidates (not search URL)  
   - One WB + one Ozon compare regression  
   - Confirm no Scrappey/Telegram Mega traffic in logs  

**No next marketplace until checklist above is green.**
