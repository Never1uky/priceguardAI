# Multi-store preparation — Phases 1–14 report

**Product:** PriceGuard AI (MV3 Chromium extension)  
**Scope:** Chrome Web Store (existing) + Microsoft Edge Add-ons + Yandex Browser distribution  
**Local / release version:** `0.9.107`  
**CWS production (operator, at start):** `0.9.106`  
**CWS extension ID:** `ipaichogganccpnapdgkjldplllnjlpf`  
**Report date:** 2026-08-26  
**Code changes in this document:** none (report only)

> Numbering here is the **multi-store / Edge–Yandex rollout** track (this workstream).  
> It is separate from earlier monitoring audits also named PHASE\* (cache, dedup, SEO product pages, etc.).

---

## Executive summary

| Decision | Outcome |
|----------|---------|
| Build strategy | **One MV3 zip** for Chrome, Edge, and Yandex (via CWS) |
| Manifest forks | **Not required** |
| `chrome.*` → `browser.*` | **Not done** (Edge/Yandex Chromium keep `chrome.*`) |
| Fake Edge/Yandex IDs | **Forbidden** — `null` until real publish |
| Release order | **Option B:** CWS `0.9.107` first, then **same** zip to Edge |
| Yandex distribution | Primarily **install from CWS inside Yandex Browser**; no confirmed separate upload catalog like Edge |
| Auto-publish | **Never** from this workstream |

**Ready for:** operator-led CWS update + Edge Partner Center submit + Yandex manual QA, using `release/0.9.107/`.

**Blocked / pending operator:** Edge & Yandex store IDs; live Edge/Yandex QA sign-off; Partner Center / CWS forms.

---

## Phase-by-phase

### Phase 1 — Release architecture (inventory)

**Doc:** `docs/audits/PHASE1_MULTI_STORE_RELEASE_ARCHITECTURE.md`

- Mapped all CWS URLs, extension ID usages, Telegram/SEO/landing hardcodes, QA scripts, UA detection gaps.
- Confirmed: shared build; SEO bridge is **caller-side ID**; Telegram install links are CWS-primary by design.
- **Code:** inventory only (no product logic change in that phase).

### Phase 2 — Version / release discipline

**Doc:** `docs/audits/PHASE2_VERSION_RELEASE_DISCIPLINE.md`

- `package.json` / `manifest` / `dist` = **0.9.107**; CWS live was **0.9.106**.
- **`npm run package:zip` always bumps** — do not use for frozen multi-store ship.
- **Recommended Option B:** ship identical `0.9.107` zip to CWS, then Edge (and Yandex via CWS).
- Rule: one version ↔ one zip; no `dist-chrome` / `dist-edge` / `dist-yandex`.

### Phase 3 — Store config

**Docs:** `docs/audits/PHASE3_STORE_CONFIG.md`  
**Code (prior work):** `src/lib/store-config.ts`, thin `chrome-store.ts` wrappers, tests.

```
STORE_CONFIG.chrome = real CWS URL/ID/reviews
STORE_CONFIG.edge|yandex = null
getPrimaryInstall/ReviewUrl() → CWS
listKnownExtensionIds() → [CWS id]
```

- Deno Telegram constants remain CWS (manual sync comment); bots must not get `null` URLs.

### Phase 4 — SEO bridge

**Docs:** `docs/audits/PHASE4_SEO_BRIDGE.md`  
**Code (prior):** `priceguard-seo` — `SITE.extensionIds[]` + `tryOpenInExtension` loop (A+C: allowlist + try in order, CWS first).

- Today list = CWS only → behavior unchanged until Edge/Yandex IDs appended.
- Chosen over UA-only routing (fragile) and custom protocols (overkill).

### Phase 5 — Hardcoded CWS links

**Docs:** `docs/audits/PHASE5_HARDCODED_CWS_LINKS.md`

| Category | Treatment |
|----------|-----------|
| Must stay CWS | Telegram bots, options “Chrome Web Store”, payment deep link, docs |
| Install CTAs | Browser-aware when Edge/Yandex URLs filled; else CWS |
| Review CTAs | Settings → browser-aware helper; softer label |
| Browser-aware | UA: Edge → Yandex → Chrome; URL or CWS fallback |

- Landing `InstallLink`, SEO `resolveInstallUrlForUa` prepared; with null Edge/Yandex URLs, UX still CWS.

### Phase 6 — Telemetry browser label

**Docs:** `docs/audits/PHASE6_TELEMETRY_BROWSER.md`  
**Code (prior):** `src/lib/browser-label.ts` — `chrome` \| `edge` \| `yandex` \| `unknown`.

- Real Yandex UA includes `Chrome/` **and** `YaBrowser/` (+ often `Yowser/`).
- Detect `YaBrowser`/`Yowser` before treating as Chrome; never send raw UA.
- Existing `browser` field on events — no new PII events.

### Phase 7 — Edge compatibility

**Doc:** `docs/EDGE_RELEASE.md`

- Expected Chromium Edge parity for permissions / SW / content scripts / Supabase / Premium / Telegram.
- Residual smoke risks: notifications UX, `openPopup` from SEO, post-update SW.
- Upload: Partner Center; same zip; after publish fill `STORE_CONFIG.edge`.

### Phase 8 — Yandex compatibility

**Doc:** `docs/YANDEX_RELEASE.md`

Split into **KNOWN COMPATIBLE** (architecture / CWS install path) vs **NEEDS MANUAL TEST** vs **POTENTIAL RISK** (module SW, hidden tabs, older Chromium, sideload limits).  
**No “fully compatible” claim without QA.**

### Phase 9 — Build / package

**Docs:** `docs/audits/PHASE9_BUILD_PACKAGE.md`, `docs/PACKAGE_RELEASE.md`

| Script | Bump? | Role |
|--------|-------|------|
| `package:zip` | **Yes** | CWS iterate-builds — **unchanged** |
| `package:release` | **No** | build → zip → validate-zip → SHA-256 + metadata |

Verified: `build` pass; zip without bump; `validate-zip` OK; `qa:preflight` 29/29.  
Fresh artifact later copied into `release/0.9.107/`.

### Phase 10 — Manifest

**Doc:** `docs/audits/PHASE10_MANIFEST.md`

- MV3; permissions minimal; hosts = core + opt-in MPs + Supabase.
- Dist: localhost stripped from `externally_connectable`; WAR sanitized.
- No `update_url`, no `minimum_chrome_version` (left unset), no Edge/Yandex manifest fork.

### Phase 11 — Privacy / disclosure

**Docs:** `docs/audits/PHASE11_PRIVACY_DISCLOSURE.md`, `docs/STORE_PRIVACY_DISCLOSURE.md`

- Policy **v2.5** aligns with opt-in hosts + Scrappey core-only.
- COMMON facts + Chrome / Edge / Yandex disclosure drafts; **one** privacy URL for all stores.
- Minor ops note: some CWS checklist lines still say v2.4 → use **2.5** in forms.

### Phase 12 — Manual QA matrix

**Doc:** `docs/MULTI_STORE_QA.md`

- Feature × Chrome / Edge / Yandex table (install, update, MPs, compare, AI, Telegram, Premium, SEO bridge, alarms, cost guards, etc.).
- Explicit scenarios: first install, upgrade, permissions, 3-MP default, expanded/disabled MP, Scrappey Free vs Premium.
- Release gate: core pass on Chrome; Edge before Edge public; Yandex before claiming support.

### Phase 13 — Release artifact

**Docs:** `docs/audits/PHASE13_RELEASE_ARTIFACT.md`, `release/README.md`

```
release/0.9.107/
  priceguard-ai-v0.9.107.zip    # single binary
  SHA256.txt
  RELEASE_NOTES.md
  EDGE_UPLOAD.md
  YANDEX_UPLOAD.md
  QA_CHECKLIST.md
```

- **One zip**, not three dist trees.  
- SHA-256: `33ad9e20784007a75d5bd7c8cdeb0a32b3716a457c77f43f0b14a7793ec2859d`  
- Path: `C:\Users\sj480\Projects\priceguard-ai\release\0.9.107\priceguard-ai-v0.9.107.zip`

### Phase 14 — Store listing drafts

**Docs:** `docs/store/chrome.md`, `edge.md`, `yandex.md`, `README.md`

Each covers: title, short/full description, category, permissions, privacy, screenshots, support/website/install/review URLs, moderation notes.  
Limits: Free **5** tracks / Premium **50**; opt-in MPs named.  
**No automatic publish.**

---

## Architecture (final picture)

```
                    ┌─────────────────────────────┐
                    │  ONE source + ONE vite build │
                    │  release/0.9.107/*.zip       │
                    └──────────────┬──────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
     Chrome Web Store        Edge Add-ons           Yandex Browser
     ID: ipaichogg…          ID: TBD                Usually same CWS ID
     listing: docs/store/    listing: docs/store/   via CWS install
     chrome.md               edge.md                docs/store/yandex.md
```

**SEO:** try `extensionIds` in order → install URL (browser-aware when configured).  
**Telegram:** install/review stay CWS until multi-link product decision.  
**Telemetry:** coarse browser enum only.

---

## Deliverables index

| Area | Path |
|------|------|
| Release pack | `release/0.9.107/` |
| Package how-to | `docs/PACKAGE_RELEASE.md` |
| Edge guide | `docs/EDGE_RELEASE.md` |
| Yandex guide | `docs/YANDEX_RELEASE.md` |
| QA matrix | `docs/MULTI_STORE_QA.md` |
| Privacy drafts | `docs/STORE_PRIVACY_DISCLOSURE.md` |
| Listing drafts | `docs/store/*.md` |
| Phase audits 1–6, 9–11, 13 | `docs/audits/PHASE*_….md` (multi-store names) |

---

## Operator checklist (next actions)

1. Run / complete `docs/MULTI_STORE_QA.md` on Chrome (and Edge before Edge public).  
2. Verify `SHA256.txt` vs zip.  
3. Upload **same** zip to CWS (0.9.106 → 0.9.107) per Option B.  
4. Upload **same** zip to Edge Partner Center (`EDGE_UPLOAD.md` + `docs/store/edge.md`).  
5. Yandex: CWS-in-browser install + Yandex column QA (`YANDEX_UPLOAD.md`).  
6. After Edge ID exists: fill `STORE_CONFIG.edge`, SEO `extensionIds` / `storeUrls`, landing; redeploy SEO/landing.  
7. Do **not** invent Yandex catalog ID unless a real listing appears.

---

## Risks & residuals

| Risk | Mitigation |
|------|------------|
| Version skew CWS 106 vs local 107 | Option B ship of identical 0.9.107 zip |
| Edge/Yandex IDs unknown | null in config; SEO try-list grows later |
| Yandex API quirks | Manual matrix; no compatibility claim yet |
| `package:zip` accidental bump | Use `package:release` / freeze pack in `release/0.9.107/` |
| Privacy checklist v2.4 typo | Forms use policy **2.5** |

---

## Verdict

Multi-store **preparation for Phases 1–14 is complete as a documentation + packaging + safe config track**: one artifact, aligned privacy/listing drafts, SEO multi-ID ready, Edge/Yandex upload/QA playbooks.  

**Shipping** remains a manual operator process (CWS → Edge → Yandex QA). No automatic store submission was performed in this workstream.
