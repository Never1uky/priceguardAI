# Release GO status — PriceGuard AI 0.9.90 (Early access)

Updated: 2026-07-24

## Verdict

| Target | Status |
|--------|--------|
| **Unlisted** CWS | **GO** — upload `priceguard-ai-v0.9.90.zip` (Submit for review) |
| **Public** CWS | After Unlisted approval + operator smoke → Visibility Public |

## Hygiene (0.9.90)

- [x] Prod build: `esbuild.drop: ['console','debugger']` (no console.log/debug in edge chunk)
- [x] Zip: only `public/icons/*` (no duplicate top-level `icons/`)
- [x] `localhost:9999` in edge bundle = Supabase JS SDK default fallback only; prod uses `VITE_SUPABASE_URL` (`https://…supabase.co`). Dead string — not a reachable prod config
- [x] Privacy v2.4: automatic support-report fields documented
- [x] Caption: **0.9.90 · Early access** (not Beta)

## Client hygiene (checked)

- [x] Нет `DEMO_LICENSE_KEYS` / UI «Демо-ключи» в `src/`
- [x] Нет `activateDevPremium` в popup
- [x] Активация лицензии только через Edge `validate-license` + JWT (вход в аккаунт)
- [x] Демо-ключи остаются только в БД seed (опционально отключить — см. `docs/sql/disable-demo-license-keys.sql`)

## Operator — upload

- [ ] ЮKassa smoke — `docs/YOOKASSA_SMOKE.md` (если ещё не для этой ветки)
- [ ] Upload → Submit for review с артефактом ниже
- [ ] Screenshots from `docs/store-assets/`
- [ ] Privacy URL + Data use + Permissions (§9 in `docs/CHROME_WEB_STORE_LISTING.md`)
  - Data use: include **automatic support error reports** (truncated message ≤800, context, version, userId) via Supabase → Telegram
- [ ] Caption: **0.9.90 · Early access**
- [ ] What's New (§2b)
- [ ] **Не** ставить Visibility = Public до апрува + smoke

## Optional (перед Public)

- [ ] Выполнить `docs/sql/disable-demo-license-keys.sql` в Supabase SQL Editor
- [ ] Deploy landing privacy (v2.4) if not live yet
- [ ] Full P0 smoke на Unlisted-сборке

## Artifact

`C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.90.zip`

Validate: `node scripts/validate-zip.mjs`
