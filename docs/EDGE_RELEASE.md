# Edge Add-ons — release guide (PriceGuard AI)

Microsoft Edge (Chromium) uses the **same MV3 package** as Chrome Web Store.  
Do **not** rewrite `chrome.*` → `browser.*`. Do **not** create `dist-edge`.

Related: `docs/audits/PHASE1_MULTI_STORE_RELEASE_ARCHITECTURE.md`, `PHASE2_VERSION_RELEASE_DISCIPLINE.md`, `docs/CHROME_WEB_STORE_LISTING.md`.

**Recommended order (Phase 2 Option B):** ship the zip to **CWS first**, then upload the **identical** zip to Edge.

---

## Compatibility checklist (why the same zip works)

| Area | Status | Notes |
|------|--------|--------|
| `chrome.*` namespace | OK | Edge exposes Chrome extension APIs |
| `tabs` / `scripting` | OK | Used without `tabs` permission where hosts allow; HiddenBrowser / SERP |
| `storage` | OK | `chrome.storage.local` / `session` |
| `alarms` | OK | Background price checks |
| `notifications` | OK | Browser alerts |
| `webNavigation` | OK | Product navigation hooks |
| Service worker + `type: module` | OK | Smoke on `edge://extensions` after load |
| Content scripts | OK | Same marketplace URL matches |
| `externally_connectable` | OK | SEO origin in **dist** (localhost stripped at build) |
| Host permissions | OK | MP + Supabase — justify in Partner Center like CWS §9 |
| Supabase / Edge Functions | OK | HTTPS to project URL; anon/publishable only in client |
| Telegram | OK | Server bots; independent of browser |
| Premium / YooKassa | OK | Payment return → landing; license via Edge Functions |
| `update_url` | Absent | Correct — store manages updates |

**Residual risks (manual smoke):** notification permission UX on Edge; `chrome.action.openPopup` from SEO bridge (soft-fail already); first-run SW after Edge update.

---

## 1. Requirements

- Microsoft account + [Partner Center](https://partner.microsoft.com/) → Edge extensions
- Same product as CWS: shopping / price compare + AI reviews + Telegram alerts
- Privacy Policy URL live: https://priceguard-landing.vercel.app/privacy
- Icons: `public/icons/icon16|32|48|128.png`
- Screenshots per [Edge Add-ons listing guidelines](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/create-dev-account) (often 1280×800 or store-specified sizes — check current form)
- One **production zip** identical to CWS upload for that version
- After first publish: record **Edge extension ID** → fill `STORE_CONFIG.edge` + SEO `extensionIds` / `storeUrls` (no fake IDs before that)

---

## 2. Build command

Gate (recommended):

```bash
npm test
npm run lint
npm run build
npm run qa:preflight
```

**Zip without bumping version** (keep current `package.json` / `manifest.json` version):

```bash
npm run package:release
```

Equivalent: `npm run build` then `node scripts/package.mjs` then `node scripts/validate-zip.mjs`.

Avoid `npm run package:zip` unless you **intend** a new patch bump (it runs `bump-version.mjs` first). See `docs/PACKAGE_RELEASE.md`.

---

## 3. Zip location

| Output | Path |
|--------|------|
| Primary | `C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v{VERSION}.zip` |
| Also | Desktop copy: `%USERPROFILE%\Desktop\priceguard-ai-v{VERSION}.zip` (from `scripts/package.mjs`) |

Verify inside the zip: `manifest.json` → `version` matches intended release; no `localhost` in `externally_connectable`.

Optional: `node scripts/validate-zip.mjs`

---

## 4. Manifest checks (dist / zip)

| Check | Expect |
|-------|--------|
| `manifest_version` | `3` |
| `background.service_worker` | `service-worker-loader.js` (CRX build), `type: module` |
| `action.default_popup` | present |
| `content_scripts` | marketplace matches present |
| `externally_connectable.matches` | includes `https://priceguard-seo.vercel.app/*` only (no localhost) |
| No `update_url` | yes |
| No `key` field | yes (store assigns ID) |
| Version | equals `package.json` for this release |

Source `manifest.json` may still list localhost for local SEO — **upload zip from `dist`**, not source tree.

---

## 5. Permissions

Declared:

- `storage`
- `notifications`
- `alarms`
- `scripting`
- `webNavigation`

**Not** requested: `tabs`, `cookies`, `identity`, `activeTab` (URL access via host permissions).

Reuse CWS justifications from `docs/CHROME_WEB_STORE_LISTING.md` §9 in the Edge Partner Center form.

---

## 6. Host permissions

- Wildberries / Ozon / Yandex Market (+ opt-in MPs: Megamarket, AliExpress, MVideo, DNS, Citilink, Eldorado, Lamoda) — scrape/compare on product & search pages
- `https://ihlfvpocwobvcpxbypsd.supabase.co/*` — Auth, sync, AI proxy, licenses, Telegram settings

List each family in the store questionnaire; do not add hosts for Edge-only.

---

## 7. Privacy requirements

| Item | Value |
|------|--------|
| Privacy Policy URL | https://priceguard-landing.vercel.app/privacy |
| Policy version (docs) | see `docs/PRIVACY_POLICY_RU.md` / landing HTML |
| Data disclosure | Align with CWS: product URLs, prices, reviews (AI sample), account email (optional), device_id, Telegram chat id (optional), price history / compare data, truncated support error reports |
| Processors | Supabase, AI providers (via Edge), Scrappey (server), YooKassa, Telegram |
| Client secrets | Publishable/anon only — **no** `service_role` in zip |

Edge form may ask “single purpose” and remote code — answer consistently with CWS §8 / listing doc.

---

## 8. Listing requirements

Reuse copy from `docs/CHROME_WEB_STORE_LISTING.md` (RU primary):

- Short + detailed description
- Category: Shopping (or Edge equivalent)
- Screenshots / promo images per Edge size rules
- Support email: `priceguardAlsupp0rt@yandex.ru`
- Support Telegram: `@priceguard_supportbot`
- Store listing language: Russian (+ English if form allows)

Note: product description still mentions “Chrome” in places — optional soft wording later; not a blocker for first Edge submit.

---

## 9. Manual tests (before upload)

On **Microsoft Edge**, load unpacked `dist/` or sideload the zip per Partner Center draft:

1. `edge://extensions` → Developer mode → Load unpacked → `dist/`
2. Service worker **active**, no `import() is disallowed` / red errors
3. Open WB / Ozon / YM product card → content script + popup opens
4. Compare smoke (default WB+Ozon+YM)
5. Sign-in (email) + tracked list persists after reload
6. Notifications permission → test alert path if easy
7. Settings → Telegram connect UI loads
8. Premium / restore path (account with license) or validate-license smoke
9. Dist manifest: no localhost in `externally_connectable`
10. SEO page CTA with **CWS** extension only may fall back to install until Edge ID is in SEO allowlist (expected)

---

## 10. Upload steps

1. Finish CWS path for this version if following Option B (same zip hash).
2. Partner Center → Microsoft Edge → Create new extension (or update).
3. Upload `priceguard-ai-v{VERSION}.zip`.
4. Fill listing, privacy URL, permissions / host justifications, age rating if asked.
5. Submit for certification.
6. When published: copy **Store listing URL** and **Extension ID** from Partner Center.
7. Update (do not invent earlier):
   - `src/lib/store-config.ts` → `STORE_CONFIG.edge`
   - `priceguard-seo` → `SITE.extensionIds` + `storeUrls.edge`
   - `priceguard-landing` → `STORE_URLS.edge`
   - Redeploy SEO + landing

---

## 11. Post-upload smoke tests

1. Install from Edge Add-ons public/listing URL (clean Edge profile).
2. Version in popup/SW matches uploaded zip.
3. Repeat §9 smoke on store-installed build (not only unpacked).
4. Confirm updates: bump a later version → same zip to CWS **and** Edge.
5. SEO «Открыть в PriceGuard» with only Edge extension installed (after ID wired).
6. Telemetry (opt-in): `browser` label should be `edge` (`Edg/` UA) — see `docs/audits/PHASE6_TELEMETRY_BROWSER.md`.
7. Payment return still opens landing; Premium unlock works from Edge session.

---

## Explicit non-goals

- No `browser.*` polyfill
- No separate Edge manifest / build flavor
- No change to marketplace / Scrappey / Premium server logic for Edge alone
