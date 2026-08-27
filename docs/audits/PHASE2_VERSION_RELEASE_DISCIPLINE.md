# Phase 2 — Version / release discipline

**Status:** strategy only. **Versions were not changed** (`package.json` / `manifest.json` remain `0.9.107`).

## Current facts

| Source | Version |
|--------|---------|
| `package.json` | `0.9.107` |
| `manifest.json` | `0.9.107` |
| `dist/manifest.json` | `0.9.107` |
| Existing zip | `priceguard-ai-v0.9.107.zip` (mtime 2026-08-25 — **rebuild before multi-store upload** if source moved since) |
| CWS production (operator) | `0.9.106` |
| `npm run package:zip` | **Always bumps** → would create `0.9.108` — do **not** run for shipping `0.9.107` |

Rule: **one version number = one byte-identical zip** uploaded to every store that gets that release.  
No `dist-chrome` / `dist-edge` / `dist-yandex`.

---

## Option A — Edge/Yandex first (`0.9.107`), then CWS

```
build 0.9.107 zip → Edge review → Yandex review → later CWS update to 0.9.107
```

| Pros | Cons |
|------|------|
| New stores launch on “latest” local bits | CWS users stay on **0.9.106** while Edge/Yandex are ahead |
| | Support splits: “which store / which version?” |
| | SEO/Telegram still point at CWS → most users on older build |
| | If 0.9.107 has a bug, new stores take the hit first; CWS is your largest installed base |
| | Harder rollback story across three catalogs |

---

## Option B — CWS first (`0.9.107`), then same artifact to Edge/Yandex

```
rebuild+validate 0.9.107 zip
  → upload CWS (update 0.9.106 → 0.9.107)
  → after CWS accepted (or at least submitted + smoke OK)
  → upload THE SAME zip to Edge + Yandex
```

| Pros | Cons |
|------|------|
| Primary channel (CWS) validates the build before new stores | Edge/Yandex wait on CWS review queue |
| One version live on the store that SEO/Telegram already advertise | Slight delay for first Edge listing |
| Support and changelog stay aligned | — |
| New-store review issues don’t strand CWS on an older “known good” while orphans run newer | — |
| Matches “one version = one artifact” with least user confusion | — |

---

## Recommendation: **Option B** (safer)

**Why safer**

1. **CWS is production** — already has users, ID, SEO bridge, Telegram install links. Ship there first.
2. **Blast radius** — regressions hit the channel you already monitor; Edge/Yandex first-time listings amplify unknown store quirks + new code at once.
3. **Support** — one public version after CWS lands; no week of “Chrome=106, Edge=107”.
4. **Same zip** — after CWS upload, do **not** rebuild for Edge/Yandex; re-upload the identical file (hash-check).

Option A only makes sense if CWS review is blocked for weeks and you must launch Edge urgently on frozen `0.9.107` **without** further commits — still weaker than B.

---

## How to ship `0.9.107` without auto-bump

Do **not** run `npm run package:zip` (it bumps to `0.9.108`).

```bash
# Gate
npm test
npm run lint
npm run build
npm run qa:preflight   # may warn if zip stale vs source — rebuild zip below

# Zip WITHOUT bump (version stays 0.9.107)
node scripts/package.mjs
```

Then:

1. Confirm zip `manifest.json` inside archive = `0.9.107`.
2. Record SHA-256 of the zip.
3. Upload that file to **CWS**.
4. Upload **the same file** to Edge Add-ons and Yandex (after CWS path is OK per Option B).

If you later need a new release: one bump → one new zip → all stores again (still Option B order preferred).

---

## Discipline checklist

| Rule | |
|------|--|
| One version ↔ one zip | Yes |
| Separate dist per store | **No** |
| Bump only when intentionally releasing a new number | Yes |
| Don’t upload an old `0.9.107.zip` from disk without confirming it matches current `dist/` | Yes |
| After Edge/Yandex get IDs, still don’t fork builds | Yes |

---

## Next (not this phase)

- Phase 3+: Edge/Yandex listing docs + smoke checklists.
- Code for multi-ID SEO only after store IDs exist.
- Version numbers left at `0.9.107` until you explicitly bump.
