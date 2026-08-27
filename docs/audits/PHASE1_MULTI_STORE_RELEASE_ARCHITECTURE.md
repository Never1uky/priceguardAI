# Phase 1 — Multi-store release architecture (inventory)

**Status:** read-only inventory complete. **No code changes in this phase.**  
**Decision from Phase 0 (confirmed):** one shared MV3 zip for Chrome + Edge + Yandex; no manifest forks.

| Fact | Value |
|------|--------|
| Local version | `0.9.107` |
| CWS production (stated) | `0.9.106` |
| CWS ID | `ipaichogganccpnapdgkjldplllnjlpf` |
| Artifact | `npm run package:zip` → `priceguard-ai-v{ver}.zip` from `dist/` |
| `update_url` | absent (keep) |

Related repos (out of this package but affect install/SEO):

- `priceguard-landing` — `SITE.chromeStoreUrl` / `SITE.extensionId`
- `priceguard-seo` — same + `runtime.sendMessage(SITE.extensionId, …)`

---

## Inventory table

| FILE | LOCATION | CURRENT BEHAVIOR | CHROME-SPECIFIC? | EDGE IMPACT | YANDEX IMPACT | RECOMMENDED CHANGE | NEED CODE CHANGE? |
|------|----------|------------------|------------------|-------------|-----------------|--------------------|-------------------|
| `src/lib/chrome-store.ts` | whole file | Canonical CWS URL + reviews URL + ID in path | Yes | Review/install CTA points to CWS | Same | Keep CWS as primary; later add Edge/Yandex URLs when IDs exist (shared constant module, not 3 manifests) | **YES** (later, after store IDs known) |
| `src/popup/components/SettingsTab.tsx` | ~443–447 | Button «Оставить отзыв в Chrome Web Store» → CWS reviews | Yes (copy + URL) | Edge users leave reviews on CWS | Same | Soften label to «Оставить отзыв» or store-aware when Edge URL exists | YES later / copy-only |
| `src/options/index.html` | ~93–96 | Hardcoded CWS href | Yes | Same | Same | Point to shared constant or landing install hub | YES later |
| `supabase/functions/_shared/telegram.ts` | `CHROME_WEB_STORE_URL` + FAQ/help strings | Install/review → CWS | Yes | Telegram install still CWS (OK primary) | Same | Keep CWS primary until Edge/Yandex live; optional multi-link | Optional later |
| `supabase/functions/_shared/alerts-faq.ts` | install/review buttons | CWS | Yes | Same | Same | Same as telegram.ts | Optional later |
| `supabase/functions/_shared/support-bot.ts` | install/review + copy «Chrome Store» | CWS | Yes | Same | Same | Same | Optional later |
| `supabase/functions/telegram-webhook/index.ts` | install buttons ~1618+ | CWS | Yes | Same | Same | Same | Optional later |
| `manifest.json` | `externally_connectable` | SEO + localhost (dev) | No (Chromium) | Works with same zip | Smoke SW/bridge | No fork; keep post-build localhost strip | **NO** |
| `vite.config.ts` | `sanitizeWebAccessibleResources` | Strips localhost from dist `externally_connectable` | No | Good for all stores | Good | Keep | **NO** |
| `src/background/index.ts` | `onMessage` / `onMessageExternal` `SEO_OPEN_COMPARE` | Accepts external messages for IDs allowed by browser | ID is **caller-side** | Bridge works only if SEO knows Edge ID | Same for Yandex ID | Multi-ID try in **SEO app**, not extension fork | SEO repo later |
| `src/lib/seo-open-compare.ts` | handler | Opens compare; `chrome.action.openPopup` soft-fail | API Chromium | OK | openPopup may fail more often | No change required for publish | **NO** |
| `src/lib/telemetry/context.ts` | `getBrowserLabel()` | `Edg/` → edge; else `Chrome/` → chrome | Partial | Edge labeled correctly | **YaBrowser often → `chrome`** | Add YaBrowser/Yandex detection | YES later (telemetry only) |
| `src/lib/telemetry/log.ts` / `export.ts` | uses `getBrowserLabel()` | Ops/export browser field | Partial | OK | Mislabel | Same | YES later |
| `scripts/package.mjs` | zip name | `priceguard-ai-v{ver}.zip` | Naming only | Same artifact OK for Edge | Same | Optional alias docs `MULTI_STORE_ARTIFACT`; no second build | **NO** (docs) |
| `scripts/qa-preflight.mjs` | header + docs list | «before Chrome Web Store» | Process | Doesn't block Edge upload | Same | Extend checklist docs for Edge/Yandex; keep same zip checks | Docs |
| `scripts/validate-zip.mjs` | zip integrity | Store-agnostic | No | Reuse | Reuse | Keep | **NO** |
| `scripts/bump-version.mjs` | version sync | Shared version | No | Sync all stores to same ver | Same | Keep one version across stores | **NO** |
| `docs/CHROME_WEB_STORE_LISTING.md` | full | CWS listing copy | Yes | Need Edge listing doc | Need Yandex listing doc | **New** listing docs; don't replace CWS | Docs |
| `docs/QA_DEBUG_CHECKLIST.md` | chrome://extensions | CWS/Chrome QA | Yes | Need Edge `edge://extensions` smoke | Need Yandex extensions UI smoke | Add multi-browser smoke section | Docs |
| `docs/RELEASE_GO.md` / `P0.5_CWS_RELEASE_CHECKLIST.md` | CWS gate | CWS only | Yes | Parallel Edge checklist | Parallel Yandex | New multi-store release doc | Docs |
| `README.md` | install steps | `chrome://extensions` | Dev UX | Mention Edge/Yandex sideload for QA | Same | Docs | Docs |
| `docs/SUPABASE_AUTH.md` | `<EXTENSION_ID>.chromiumapp.org` | OAuth redirect per ID | Docs (OAuth unused in code) | New ID if OAuth ever enabled | Same | Note multi-ID if OAuth returns | Docs only |
| `docs/SEO_PRODUCT_PAGES.md` | CTA / CWS id | Documents CWS install fallback | Yes | SEO must try multiple IDs | Same | Update when Edge/Yandex published | Docs + SEO later |
| **`priceguard-seo` `src/lib/config.ts`** | `extensionId`, `chromeStoreUrl` | Single CWS ID for `sendMessage` | Yes | **SEO CTA fails** if only Edge installed | Same | `extensionIds: [cws, edge, yandex]` try-in-order + install hub | **YES** (seo repo, after IDs) |
| **`priceguard-seo` `compare-cta.tsx`** | `sendMessage(SITE.extensionId)` | One ID | Yes | Bridge broken for Edge-only users | Same | Multi-ID loop | YES (seo) |
| **`priceguard-landing` `src/site.ts`** | `chromeStoreUrl`, `extensionId` | CWS only | Yes | Install CTA → CWS (acceptable) | Same | Optional Edge/Yandex links / browser detect | Optional later |
| `priceguard-seo/README.md` | sample URL | Mentions **different** ID `lpmioobg…` (stale) | Docs drift | Confusion | Confusion | Fix README to CWS ID | Docs (seo) |
| All `chrome.*` usage | throughout `src/` | Chromium extension APIs | Namespace Chrome | Edge compatible | Yandex Chromium — smoke | **Do not** polyfill/rewrite | **NO** |
| Marketplace / match / AI / Scrappey / Premium / Telegram bots logic | core | Shared | No | None | None | No change | **NO** |
| `update_url` | absent | Store updates | No | Edge Add-ons manages updates | Yandex catalog manages | Keep absent | **NO** |
| Fake / placeholder store IDs | — | None in extension | — | — | — | Never invent IDs | **NO** |

---

## Architecture decision (Phase 1)

```
                    ┌─────────────────────────────┐
                    │  ONE source + ONE vite build │
                    │  dist/ → one zip             │
                    └──────────────┬──────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
     Chrome Web Store        Edge Add-ons           Yandex catalog
     ID: ipaichogg…          ID: (TBD after pub)    ID: (TBD after pub)
     listing: CWS doc        listing: Edge form     listing: Yandex form
```

Store-specific **later** (only when needed):

- Constants: install/review URLs (extension + Telegram + landing/SEO)
- SEO: multi-`extensionId` probe
- Docs/QA: Edge/Yandex smoke
- Telemetry: YaBrowser label

**Not** separate manifests, not business-logic forks.

---

## MULTI-STORE RELEASE REPORT

### READY FOR EDGE

- Shared MV3 zip from current pipeline is the intended upload artifact.
- Permissions / hosts / SW / content scripts — no Edge-specific change required to publish.
- Premium, Telegram, Supabase — browser-agnostic.
- `update_url` correctly absent.
- Production `externally_connectable` already cleaned of localhost.

### READY FOR YANDEX

- Same zip is the intended artifact pending **manual smoke** (SW module, content scripts, alarms, notifications, hidden tabs).
- No code blocker identified for packaging.

### BLOCKED

| Blocker | Why |
|---------|-----|
| **Edge / Yandex extension IDs unknown** | Assigned at first publish — cannot wire SEO multi-ID or Edge review URLs yet |
| **Partner / catalog accounts & listings** | Manual: Microsoft Partner Center, Yandex extensions catalog |
| **Version skew** | Local `0.9.107` vs CWS prod `0.9.106` — decide ship version before multi-upload |
| **SEO bridge single-ID** | Until Edge/Yandex IDs exist + SEO updated, bridge only talks to CWS install |

Not blocked: building the zip; uploading same bits to Edge after account ready.

### MANUAL ACTION REQUIRED

1. Microsoft Partner Center — register, create Edge Add-ons listing, privacy/permissions questionnaire (reuse CWS copy from `docs/CHROME_WEB_STORE_LISTING.md`).
2. Yandex Browser extensions catalog — account + listing requirements.
3. After each first publish: **record Edge ID and Yandex ID** (never invent).
4. Then (later phase): update `priceguard-seo` / landing / optional Telegram install links.
5. Assets: screenshots may need store-specific sizes — check Edge/Yandex guidelines vs CWS 1280×800.
6. Align version: either publish `0.9.107` to all three or bump once and upload everywhere.

### CWS REGRESSION RISK

| Change deferred | Risk if done carelessly |
|-----------------|-------------------------|
| Softening review button copy | Low |
| Telegram multi-store links | Low (keep CWS primary) |
| SEO multi-ID | **Medium** if wrong ID / break CWS sendMessage — must keep CWS ID first in list |
| Manifest / permissions | **High** — do not touch for Edge/Yandex |
| Marketplace / Premium / Scrappey | **Do not change** |

**This phase changed nothing → CWS regression risk = none.**

### FILES CHANGED

**None** (Phase 1 inventory only).  
This document: `docs/audits/PHASE1_MULTI_STORE_RELEASE_ARCHITECTURE.md`.

### COMMANDS TO RUN

```bash
# Same artifact for all three stores (when shipping):
npm test
npm run lint
npm run build
npm run qa:preflight
npm run package:zip   # bumps version — use consciously

# Validate zip (optional):
node scripts/validate-zip.mjs
```

Do **not** create `package:edge` / `package:yandex` builds unless a real manifest delta appears (none today).

### EXACT UPLOAD ARTIFACT

| Field | Value |
|-------|--------|
| File | `priceguard-ai-v{VERSION}.zip` at repo root (and Desktop copy from `package.mjs`) |
| Contents | Entire `dist/` (post CRX build + localhost strip) |
| Same file for | CWS update, Edge Add-ons, Yandex catalog |
| Not for upload | Source tree, `manifest.json` with localhost, unpacked without build |

Example after next `package:zip`: `C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.108.zip` (version depends on bump).

Current local without new bump: rebuild with `npm run build` then zip **without** bump if you need `0.9.107` artifact — today `package:zip` always bumps; for aligned `0.9.107` use existing zip if valid or `npm run build` + `node scripts/package.mjs` (no bump).

### EXACT MANUAL TESTS BEFORE UPLOAD

**Shared (any Chromium):**

1. Load `dist/` unpacked → SW active, no `import()` error.  
2. Open WB/Ozon/YM card → content script, popup compare smoke.  
3. Auth + track list + Telegram link settings.  
4. Dist manifest: no localhost in `externally_connectable`.

**Edge-specific:**

1. `edge://extensions` → load unpacked `dist/` (or install from Partner Center package).  
2. Same smoke as above.  
3. Notifications + alarm-driven check (if used).  
4. SEO CTA with **CWS** ID still works if Chrome extension also installed; Edge-only → expect install fallback until multi-ID.

**Yandex-specific:**

1. Install/load in Яндекс.Браузер extensions UI.  
2. SW module alive after restart.  
3. Content scripts on ozon.ru / wildberries.ru / market.yandex.ru.  
4. Compare path that uses hidden tab / scripting.  
5. Notifications + alarms.  
6. Note Chromium version (about page) if failures.

---

## What can be fixed automatically (later phases — not done now)

1. Docs: Edge + Yandex listing templates + multi-store smoke checklist.  
2. Telemetry: detect `YaBrowser`.  
3. After IDs known: centralize store URLs; SEO multi-ID `sendMessage` loop (CWS first).  
4. Optional: review button label without “Chrome Web Store” only.

## What requires manual action

Partner Center, Yandex catalog, first-publish IDs, store screenshots/policies, version alignment with live CWS.

## What can affect CWS

Only future SEO/Telegram/URL edits — keep CWS ID/URL as primary. No manifest/permission changes planned.

---

## Stop point

Phase 1 complete: inventory + architecture report. **No production code modified.**  
Next (when approved): Phase 2 — docs/checklists + optional non-behavior packaging notes; code changes only for telemetry/docs unless you explicitly unlock store-URL work after IDs exist.
