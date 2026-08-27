# Phase 10 — Manifest audit (multi-store)

**Verdict:** One MV3 manifest is fine for CWS + Edge + Yandex (via CWS).  
**No code changes this phase.** No extra permissions, no `update_url`, no Edge/Yandex fork.

Compare **source** `manifest.json` vs **dist** (store upload = dist/zip only).

---

## Field checklist

| Field | Source | Dist (production) | Status |
|-------|--------|-------------------|--------|
| `manifest_version` | `3` | `3` | OK |
| `version` | `0.9.107` | `0.9.107` | OK |
| `permissions` | storage, notifications, alarms, scripting, webNavigation | same | OK — minimal set |
| `host_permissions` | MP hosts + Supabase project | same | OK — justified by product |
| `content_scripts` | TS entry + MP matches | hashed loader + same matches | OK |
| `background` | `src/background/index.ts`, `type: module` | `service-worker-loader.js`, `type: module` | OK |
| `externally_connectable` | SEO + localhost:3000 | **SEO only** (localhost stripped at build) | OK for zip |
| `web_accessible_resources` | (none in source; CRX emits) | narrowed origins; no edge/supabase chunks | OK — build fails if edge in WAR |
| `icons` / `action.default_icon` | 16/32/48/128 under `public/icons/` | same paths | OK |
| `action` | popup + title | same | OK |
| `options_ui` | options page, open_in_tab | same | OK |
| `minimum_chrome_version` | **absent** | **absent** | OK leave unset (see below) |
| `update_url` | **absent** | **absent** | OK — store-managed updates |
| `key` | absent | absent | OK — store assigns ID |

---

## Permissions (do not expand)

| Permission | Why needed |
|------------|------------|
| `storage` | settings, tracks, auth session, telemetry ring |
| `notifications` | price-drop browser alerts |
| `alarms` | scheduled checks |
| `scripting` | inject/execute on marketplace tabs (compare/SERP) |
| `webNavigation` | product navigation hooks |

**Not present (keep out):** `tabs`, `cookies`, `identity`, `activeTab`, `webRequest`, `debugger`, etc.

Host access for marketplace URLs comes from `host_permissions`, not a blanket `tabs` permission.

---

## Host permissions

- Core: Wildberries, Ozon, Yandex Market (+ WB card/search/feedback/basket APIs)
- Opt-in MPs: Megamarket, AliExpress, MVideo, DNS, Citilink, Eldorado, Lamoda
- Backend: `https://ihlfvpocwobvcpxbypsd.supabase.co/*`

No “just in case” hosts added this phase.

---

## externally_connectable

| Environment | Matches |
|-------------|---------|
| Source (dev) | `priceguard-seo.vercel.app` + localhost:3000 |
| Dist / zip | `https://priceguard-seo.vercel.app/*` only |

Always ship the **zip**, not raw source manifest.

---

## web_accessible_resources

CRXJS generates WAR for content-script chunk graph. Post-build (`vite.config.ts`):

- Narrow matches to `scheme://host/*`
- Fail build if `edge-*` / supabase chunks appear in WAR

Current dist resources: content-related asset chunks only (hashed names change per build).

---

## minimum_chrome_version

**Not set.** Optional later if store review asks for a floor (e.g. modern MV3 module SW).  
Do **not** add without a concrete Edge/Yandex failure requiring it.

---

## Separate Edge / Yandex manifests?

**No.** Confirmed unnecessary (Phases 0–8): same permissions, hosts, SW, content scripts. Store differences = listing metadata + extension IDs after publish, not manifest forks.

---

## Explicit non-actions (this phase)

- No new permissions  
- No `update_url`  
- No second `manifest.json`  
- No `minimum_chrome_version` unless proven need  

## Upload reminder

Use `dist/manifest.json` inside `priceguard-ai-v*.zip` from `npm run package:release` / `package.mjs`.
