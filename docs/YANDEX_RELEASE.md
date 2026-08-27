# Yandex Browser — release & compatibility guide (PriceGuard AI)

**Do not claim “fully compatible” without manual smoke on a real Яндекс.Браузер build.**  
This doc separates **known from architecture / public docs**, **must test**, and **risk**.

Same MV3 zip as CWS/Edge. Do **not** rewrite `chrome.*` → `browser.*`. Do **not** create `dist-yandex`.

Related: `docs/EDGE_RELEASE.md`, `docs/audits/PHASE1_MULTI_STORE_RELEASE_ARCHITECTURE.md`, `PHASE2_VERSION_RELEASE_DISCIPLINE.md`, `PHASE6_TELEMETRY_BROWSER.md`.

---

## Distribution reality (read first)

Per [Yandex Browser help](https://yandex.ru/support/browser/ru/personalization/extension): users install third-party extensions mainly from:

- [Chrome Web Store](https://chromewebstore.google.com/) (“Добавить в Яндекс Браузер”), or  
- Opera add-ons  

There is **no confirmed separate Partner Center–style catalog** for arbitrary MV3 uploads like Edge Add-ons. Treat “Yandex release” as:

1. **Primary:** CWS listing works when user installs PriceGuard **inside** Yandex Browser from CWS → **same extension ID** as Chrome (`ipaichogganccpnapdgkjldplllnjlpf`).  
2. **QA:** sideload / unpacked `dist/` in Yandex for compatibility tests.  
3. **If** a first-party Yandex extensions catalog / partner program appears later → record any **new** ID only after publish (never invent); update `STORE_CONFIG.yandex`.

Until (3) exists, SEO bridge + CWS ID already covers Yandex users who installed from CWS.

---

## KNOWN COMPATIBLE

(Architecture / Chromium heritage / public Yandex docs — **not** a substitute for § Manual tests.)

| Item | Basis |
|------|--------|
| Chromium extension platform | Yandex Browser is Chromium-based; CWS extensions are the supported install path |
| Manifest V3 as a format | Same package type as CWS; many CWS MV3 extensions run in Yandex — **still verify our build** |
| `chrome.*` namespace (in principle) | Chromium API surface; we keep `chrome.*` (no polyfill) |
| Shared zip with CWS | One artifact; no Yandex-specific build required for CWS-via-Yandex install |
| Supabase / Telegram / Premium **server** paths | HTTPS backends do not depend on browser brand once the extension can call them |
| Payment return URL | Landing page (`VITE_PAYMENT_RETURN_URL`) — browser-agnostic |
| Telemetry label `yandex` | UA tokens `YaBrowser/` / `Yowser/` (see Phase 6) — when extension runs |
| SEO `externally_connectable` | Same origin allowlist in dist; works if the **installed** extension ID is in SEO allowlist (CWS ID today) |

---

## NEEDS MANUAL TEST

Run on a **current** Яндекс.Браузер desktop (note version + Chromium version from `browser://version` or About). Load **unpacked `dist/`** and/or install from **CWS inside Yandex**.

| Area | What to verify |
|------|----------------|
| **MV3 load** | Extension enables; no “unsupported” banner |
| **Module service worker** | SW status active; no `import() is disallowed` / module errors |
| **`chrome.runtime`** | Popup ↔ SW messages; `getManifest().version` |
| **`chrome.storage`** | Settings + tracks survive reload |
| **`chrome.tabs`** | Open product / create tab for offers |
| **`chrome.scripting`** | Inject / execute on marketplace tabs |
| **`chrome.alarms`** | Alarm fires (or schedule visible in SW); periodic check path |
| **`chrome.notifications`** | Permission prompt + notification shows |
| **`chrome.webNavigation`** | Product navigation hooks (no flood of errors) |
| **Content scripts** | WB / Ozon / YM product + search pages |
| **Hidden / background tabs** | Compare / SERP / reviews via HiddenBrowser — completes or degrades cleanly |
| **Marketplace pages** | Parse price/title; no permanent CSP block |
| **SEO bridge** | From `priceguard-seo.vercel.app` CTA with extension installed (CWS ID) |
| **Supabase requests** | Login, sync, AI proxy call |
| **Telegram connection** | Settings → link / bot deep link UX |
| **Premium** | Restore / validate-license / unlocker path if account available |
| **Payment return** | Complete test payment → landing → Premium visible in Yandex session |
| **Extension update** | CWS update while running in Yandex; SW restarts; data kept |

Checklist template: copy rows into QA sheet; mark Pass/Fail + Yandex version.

---

## POTENTIAL RISK

| Risk | Why | Mitigation |
|------|-----|------------|
| Older Chromium in some Yandex channels | Module SW / MV3 gaps | Record browser + Chromium version on fail; require recent stable |
| Hidden tabs / background scrape throttled | Battery / session policies differ from Chrome | Prefer visible tab / cache / server paths; soft-fail UI |
| Notifications blocked or different UX | OS + browser permission model | Document grant steps for support |
| `chrome.action.openPopup` from SEO | May fail without gesture | Already soft-caught; pending storage still set |
| Content script timing on ozon.ru / wb | DOM / anti-bot differs | Same as Chrome risk; confirm live |
| Sideload vs CWS install | Yandex may restrict non-store CRX | Prefer CWS install for real users; unpacked only for QA |
| Separate Yandex catalog ID (if ever) | SEO allowlist must gain ID | Phase 4 multi-ID loop; fill `STORE_CONFIG.yandex` only with real ID |
| Assuming “Yandex store upload” like Edge | May not exist | Primary ship = **CWS**; Yandex = compatibility + install-from-CWS |

---

## Build & artifact (same as Edge/CWS)

```bash
npm run package:release
```

Zip: `priceguard-ai-v{VERSION}.zip` in repo root (+ Desktop copy).  
See `docs/PACKAGE_RELEASE.md`. `package:zip` still bumps — do not use it for a frozen multi-store ship.

---

## Manual test procedure (Yandex)

1. Install current Яндекс.Браузер; note version.  
2. `browser://extensions` (or Extensions UI) → Developer mode → Load unpacked → `dist/`.  
3. Run **NEEDS MANUAL TEST** table (core: SW, storage, one MP card, compare, login).  
4. Separately: install from CWS in Yandex → repeat critical smoke.  
5. File failures with: Yandex version, Chromium version, SW console snippet, marketplace URL.

Do **not** mark Phase 8 “compatible” in release notes until the CWS-in-Yandex smoke passes.

---

## Post–CWS publish (Yandex users)

1. From Yandex: open CWS PriceGuard page → Add to Yandex Browser.  
2. Confirm ID is still CWS ID (expected).  
3. SEO CTA + Telegram install links (CWS) remain valid.  
4. Telemetry opt-in: expect `browser: "yandex"`.  
5. Only if a distinct Yandex store ID appears later → update store-config / SEO / landing.

---

## Explicit non-goals

- No `browser.*` rewrite  
- No `dist-yandex`  
- No fake Yandex extension ID  
- No claim of full API parity without the manual matrix above
