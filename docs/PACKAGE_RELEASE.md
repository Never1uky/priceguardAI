# Packaging — CWS vs multi-store release

## Scripts

| Command | Bump version? | What it does |
|---------|---------------|----------------|
| `npm run build` | No | `tsc && vite build` → `dist/` |
| `npm run package:zip` | **Yes** (patch) | bump → build → zip. CWS iterate-builds (`0.9.107` → `0.9.108`). **Do not change this for Edge/Yandex.** |
| `npm run package:release` | **No** | build → zip current version → `validate-zip` → SHA-256 + metadata |
| `npm run qa:preflight` | No | listing/icons/manifest/docs checks (expects a zip for current version) |
| `node scripts/validate-zip.mjs` | No | inspect latest zip for current version |
| `node scripts/package.mjs` | No | zip `dist/` only (needs prior `build`) |

Same zip is uploaded to Chrome Web Store, Edge Add-ons, and used by Yandex users via CWS. No `dist-edge` / `dist-yandex`.

## When to use which

- **CWS “new build number”:** `npm run package:zip` (workspace rule: bump so Chrome/zip name shows the build).
- **Ship a frozen version to all stores (Phase 2 Option B):** `npm run package:release` — does **not** bump. Print SHA-256 and upload **that** file everywhere.
- **QA only:** `npm run build` then `npm run qa:preflight` (zip may be stale — rebuild zip if needed).

## Artifact

```
priceguard-ai-v{VERSION}.zip
```

Path printed as `Path:` / `Путь:`. If that filename exists, `(1)` suffix is used.

## Checks `package:release` enforces

- `validate-zip.mjs` (icons, refs, no stray `console.log` in edge chunk, supabase URL)
- dist version = package.json version
- no localhost in dist `externally_connectable`
