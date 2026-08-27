# Phase 15 — Build / Release

## Verdict

**Ready to package for CWS** after green gate: `npm test`, `npm run lint`, `npm run build`, `npm run qa:preflight`. No production secrets were changed.

| Command | Result |
|---------|--------|
| `npm test` | **922 passed**, 13 skipped |
| `npm run lint` | **pass** |
| `npm run build` | **pass** (`tsc && vite build`) |
| `npm run qa:preflight` | **29/29 pass** (version `0.9.107`) |

One test fix this phase: `search-settings.test.ts` now mocks `loadServerMarketplaceFlags` so Phase 10 server gating does not strip intentional megamarket/test-MP selections in unit tests.

## Production build audit

| Item | Status | Notes |
|------|--------|-------|
| **manifest (source)** | OK | MV3 `0.9.107`; SW `src/background/index.ts` |
| **manifest (dist)** | OK | SW → `service-worker-loader.js`; content → hashed loaders |
| **permissions** | OK | `storage`, `notifications`, `alarms`, `scripting`, `webNavigation` only |
| **host_permissions** | OK | Core + test MPs + `https://ihlfvpocwobvcpxbypsd.supabase.co/*` |
| **CSP** | OK (default) | No custom `content_security_policy` in manifest; MV3 default applies |
| **service worker** | OK | Build plugin bans dynamic `import()` in SW graph |
| **Supabase URL** | OK | Dist embeds `https://ihlfvpocwobvcpxbypsd.supabase.co` |
| **Edge URLs** | OK | Built via `functionsUrl(name)` → `{url}/functions/v1/{name}` |
| **API keys in client** | OK | Only **publishable/anon** (`sb_publishable_…`). **No `service_role`** in `dist/` |
| **Scrappey / payment secrets** | OK | Server-only; not in extension bundle |
| **debug / agent log** | OK | `src/lib/debug-log.ts` is no-op; no debug host permission |
| **console.\*** | OK | Source has `console.info/warn` for ops; **stripped in prod chunks** (`dropConsoleInChunks`) — `dist/` has **0** `console.(log\|debug\|info\|warn)(` |
| **development endpoints** | OK | No localhost Edge/dev API in dist bundles |
| **externally_connectable** | OK for zip | Source keeps `localhost:3000` for SEO local; **vite strips localhost/127.0.0.1 from dist** → only `https://priceguard-seo.vercel.app/*` |
| **web_accessible_resources** | OK | Build fails if edge/supabase chunks exposed to MP pages |

## Explicit non-changes

- Did **not** rotate or edit production secrets / Supabase keys / Scrappey / YooKassa.
- Did **not** run `package:zip` (version bump) in this phase — run when shipping.

## Residual / release notes (non-blocking)

1. **Source `manifest.json`** still lists localhost in `externally_connectable` for local SEO bridge; production artifact is already cleaned by Vite. Prefer shipping **`dist/` / zip**, not raw source manifest.
2. **Publishable key** is visible in client JS by design (RLS + Edge JWT). Treat as public; protect with RLS and Edge auth.
3. **Chunk size warning**: `storage-*.js` ~556 kB — pre-existing; not a release blocker.
4. **Phase 14 follow-up**: redeploy `priceguard-seo` if sitemap `is_primary` filter is not yet live on Vercel.
5. Existing zip from preflight: `priceguard-ai-v0.9.107.zip` (may predate latest source; rebuild with `npm run package:zip` before CWS upload).

## Ship checklist

```bash
npm test
npm run lint
npm run build
npm run qa:preflight
npm run package:zip   # when ready to upload — bumps patch + zips dist/
```

Upload the zip path printed by `package:zip`, load in `chrome://extensions` once, smoke: popup open, compare one core MP, auth/settings load, no SW crash.
