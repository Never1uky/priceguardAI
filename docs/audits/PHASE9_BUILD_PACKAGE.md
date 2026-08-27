# Phase 9 — Build / package

## Commands checked

| Command | Result | Note |
|---------|--------|------|
| `npm run build` | **pass** (0.9.107) | `tsc && vite build` |
| `node scripts/package.mjs` | **pass** | zip **without** bump |
| `node scripts/validate-zip.mjs` | **OK** | latest zip for 0.9.107 |
| `npm run qa:preflight` | **29/29** | still looks for `priceguard-ai-v0.9.107.zip` (older file); fresh artifact is `(1)` |
| `npm run package:zip` | **not run** | would bump to 0.9.108; **script unchanged** |
| `npm run package:release` | **added** | wrapper: build + zip + validate + SHA-256 |

## Fresh artifact (this phase)

```
Готово: priceguard-ai-v0.9.107(1).zip
Путь: C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.107(1).zip
Версия расширения: 0.9.107
SHA-256: 33ad9e20784007a75d5bd7c8cdeb0a32b3716a457c77f43f0b14a7793ec2859d
```

Dist: SW `service-worker-loader.js`; `externally_connectable` = SEO only (no localhost). `validate-zip`: no demo key, public/icons present.

## Why `package:release`

`package:zip` must keep bumping for CWS. Multi-store needs frozen version + checksum. New script does **not** replace `package:zip`.

## CWS regression

`package:zip` in `package.json` is unchanged.

## Docs

- `docs/PACKAGE_RELEASE.md`
- `docs/EDGE_RELEASE.md` / `YANDEX_RELEASE.md` point at `package:release`
