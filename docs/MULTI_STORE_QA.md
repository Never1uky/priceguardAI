# Multi-store QA matrix — PriceGuard AI

Manual smoke across **Chrome**, **Microsoft Edge**, and **Яндекс.Браузер**.  
Same zip for all (`docs/PACKAGE_RELEASE.md`). Do not mark Yandex “pass” without a real browser run (`docs/YANDEX_RELEASE.md`).

| Field | Meaning |
|-------|---------|
| Chrome / Edge / Yandex | `☐` pending · `P` pass · `F` fail · `N/A` · `S` skipped |
| Result | Overall for the row after all browsers |
| Notes | Version, URL, SW error snippet |

**Build under test:** version ______ · zip ______ · SHA-256 ______  
**Dates:** Chrome ______ · Edge ______ · Yandex ______  
**Tester:** ______

**Browser versions:** Chrome ______ · Edge ______ · Yandex / Chromium ______

Related: `docs/EDGE_RELEASE.md`, `docs/YANDEX_RELEASE.md`, `docs/QA_DEBUG_CHECKLIST.md`, Phase 16 manual monitoring plan.

---

## Matrix

| Feature | Chrome | Edge | Yandex | Expected | Result | Notes |
|---------|:------:|:----:|:------:|----------|--------|-------|
| **INSTALL** — first install (clean profile) | ☐ | ☐ | ☐ | Icon; SW active; empty tracks; defaults WB+Ozon+YM | | |
| **INSTALL** — from store listing (not only unpacked) | ☐ | ☐ | ☐ | CWS / Edge Add-ons / CWS-in-Yandex | | Yandex: usually CWS |
| **UPDATE** — existing user (tracks + settings survive) | ☐ | ☐ | ☐ | No wipe; version bumps; login if was signed in | | |
| **PERMISSIONS** — grant storage/notifications as prompted | ☐ | ☐ | ☐ | No unexpected permission; hosts match listing | | |
| **POPUP** — open on toolbar | ☐ | ☐ | ☐ | Renders; no blank/crash | | |
| **OPTIONS** — open_in_tab | ☐ | ☐ | ☐ | Options page loads; CWS link optional | | |
| **WB** — product card content script | ☐ | ☐ | ☐ | Price/title scraped or clear OOS | | |
| **OZON** — product card | ☐ | ☐ | ☐ | Same | | |
| **YANDEX MARKET** — product/card | ☐ | ☐ | ☐ | Same | | |
| **OTHER MARKETPLACES** — opt-in enabled (e.g. Megamarket) | ☐ | ☐ | ☐ | Appears in compare only if selected + server `marketplace_enabled` | | |
| **DISABLED MARKETPLACE** — server flag / deselected | ☐ | ☐ | ☐ | Not in «Где искать» targets; no scrape attempt | | |
| **3 MARKETPLACE DEFAULT** — fresh install | ☐ | ☐ | ☐ | Selected = WB + Ozon + YM only | | |
| **EXPANDED SELECTION** — enable extra MPs in settings | ☐ | ☐ | ☐ | Persist; compare uses intersection with server flags | | |
| **SEARCH** — SERP / search page on core MP | ☐ | ☐ | ☐ | Candidates or clear empty | | |
| **COMPARE** — run from card | ☐ | ☐ | ☐ | Table fills; progress; no hang forever | | |
| **MATCHING** — plausible offers / reject junk | ☐ | ☐ | ☐ | No obvious false match on smoke SKU | | |
| **AI** — review analysis (signed in) | ☐ | ☐ | ☐ | Result or quota message; no SW crash | | |
| **CACHE** — second compare / price resolve | ☐ | ☐ | ☐ | Faster / no duplicate Scrappey when fresh | | |
| **PRICE HISTORY** — tracked product | ☐ | ☐ | ☐ | History UI or cloud history if signed in | | |
| **TELEGRAM** — connect Chat ID / link | ☐ | ☐ | ☐ | Settings UX; sync when logged in | | |
| **TELEGRAM ALERTS** — monitoring on | ☐ | ☐ | ☐ | Alert or bot ack; server path | | Browser-agnostic server |
| **ALERTS** — browser notification on drop (if easy) | ☐ | ☐ | ☐ | Notification shows after permission | | |
| **PREMIUM** — restore / validate license | ☐ | ☐ | ☐ | Premium UI; limits 50 | | |
| **TRIAL** — claim if eligible | ☐ | ☐ | ☐ | Trial window or already-used | | |
| **PAYMENT RETURN** — YooKassa success URL | ☐ | ☐ | ☐ | Landing → Premium in extension session | | |
| **SEO → EXTENSION** | ☐ | ☐ | ☐ | CTA opens compare or install fallback | | Edge ID later; CWS ID today |
| **NOTIFICATIONS** API | ☐ | ☐ | ☐ | Permission + sample if available | | |
| **ALARMS** — scheduled check registered | ☐ | ☐ | ☐ | SW alarms present / fire | | |
| **BACKGROUND CHECK** — SW check while popup closed | ☐ | ☐ | ☐ | Log or price refresh without popup | | |
| **ERROR HANDLING** — offline / 502 soft path | ☐ | ☐ | ☐ | No false drop alert; UI recoverable | | |
| **UNINSTALL / REINSTALL** | ☐ | ☐ | ☐ | Clean remove; reinstall first-run or cloud restore if login | | |
| **SCRAPPEY COST GUARDS** — Free vs Premium unlocker | ☐ | ☐ | ☐ | Free: no interactive Scrappey; Premium may unlock | | Server-enforced |
| **TELEMETRY browser label** (opt-in / export) | ☐ | ☐ | ☐ | `chrome` / `edge` / `yandex` | | Phase 6 |

---

## Scenario focus (run explicitly)

### A. First install

1. Clean profile → install zip/store.  
2. Confirm **3 marketplace default** (no forced Megamarket/Ali/…).  
3. Open one WB or Ozon card → popup.  
4. Run compare once.

### B. Existing user upgrade

1. Profile with tracks + Telegram settings + login.  
2. Replace with new zip / store update.  
3. Confirm data retained; SW healthy.

### C. Permissions

1. Note prompts on install.  
2. Confirm no `tabs`/`cookies` in chrome:// or edge:// details beyond declared hosts.

### D. Disabled marketplace

1. Deselect YM (or rely on server `marketplace_enabled=false` for a test MP).  
2. Compare must not target it.

### E. Expanded marketplace selection

1. Enable one opt-in MP allowed by server flags.  
2. Compare includes it; disable again → excluded.

### F. Telegram alerts + cost guards

1. Premium/trial: Telegram monitoring on core MP product.  
2. Free: confirm no Scrappey unlocker on compare card path (cache/legacy only).  
3. Optional: two users same SKU → one scrape (Phase 16) — server SQL, not browser-specific.

### G. SEO → extension

1. Open SEO product page → «Открыть в PriceGuard AI».  
2. With extension installed (CWS ID): compare starts or pending.  
3. Without: install link (browser-aware URL when configured).

---

## Pass criteria (release gate)

| Must pass on Chrome | Must pass on Edge before Edge public | Must pass on Yandex before claiming support |
|---------------------|--------------------------------------|---------------------------------------------|
| INSTALL, POPUP, WB/OZON/YM, COMPARE, UPDATE or first-run, PREMIUM or free path | Same core set | Same core set on **CWS-in-Yandex** or unpacked |
| SEO bridge with CWS ID | SEO may N/A until Edge ID wired | SEO with CWS ID if installed from CWS |

Optional / staging: Scrappey 502, full Phase 16 shared monitoring SQL.

---

## Sign-off

| Browser | Core gate | Signature | Date |
|---------|-----------|-----------|------|
| Chrome | ☐ Pass ☐ Fail | | |
| Edge | ☐ Pass ☐ Fail ☐ Not shipping yet | | |
| Yandex | ☐ Pass ☐ Fail ☐ Compatibility only | | |
