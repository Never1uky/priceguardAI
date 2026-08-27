# Phase 5 — Hardcoded CWS links

## Categories

### 1. Must stay CWS (or CWS-named)

| Place | Why |
|-------|-----|
| `docs/CHROME_WEB_STORE_LISTING.md`, CWS checklists, Partner copy | Store-specific listing docs |
| `options/index.html` «Chrome Web Store» | Explicit named link to CWS listing |
| Telegram bots (`telegram.ts`, alerts-faq, support-bot, webhook) | Server has **no** reliable browser UA; one stable install URL |
| Blog **static** install constants in article bodies | SSR/static text; CWS as primary marketing OK |
| `PaymentSuccessPage` `chrome-extension://${CWS_ID}/…` | Deep link needs a real ID; keep CWS until multi-ID payment return |
| SEO `sendMessage` allowlist order | CWS ID **first** (Phase 4) — not a “link”, but related |

### 2. «Установить расширение»

| Place | Treatment |
|-------|-----------|
| Landing Header / Home / Blog CTA | **Browser-aware** → `InstallLink` / `resolveInstallUrlForUa` |
| SEO CTA install fallback | **Browser-aware** → `extensionInstallUrl()` |
| Telegram install buttons | Stay **CWS** (cat. 1) |

### 3. «Оставить отзыв»

| Place | Treatment |
|-------|-----------|
| Extension Settings | **Browser-aware** review URL; label softened to «Оставить отзыв» |
| Telegram review buttons | Stay **CWS** (server) |

### 4. Browser-aware (when Edge/Yandex URLs exist)

| Place | Helper |
|-------|--------|
| Extension popup review | `getReviewUrlForCurrentBrowser()` |
| Landing install CTAs | `resolveInstallUrlForUa` |
| SEO install fallback | `resolveInstallUrlForUa` |
| Telemetry browser label | YaBrowser → `yandex` (aligned with UA rules) |

Rule: preferred channel URL if non-null, else **CWS**.

---

## Minimal solution (chosen)

```
detect: Edg/ → edge; YaBrowser/Yowser → yandex; else → chrome
resolveInstall/Review(ua): STORE[channel].url ?? STORE.chrome.url
```

- No multi-store mega-framework.
- No fake Edge/Yandex URLs (still `null` → CWS today = **no user-facing change** until filled).
- Telegram unchanged (CWS).
- Reuses same UA order as telemetry (updated for Yandex).

---

## Implemented

**priceguard-ai**

- `store-config.ts`: `detectStoreChannelFromUa`, `resolveInstallUrlForUa`, `resolveReviewUrlForUa`
- `chrome-store.ts`: `getInstallUrlForCurrentBrowser`, `getReviewUrlForCurrentBrowser`
- `SettingsTab`: review via browser helper; label «Оставить отзыв»
- `telemetry/context.ts`: detect Yandex
- tests for UA + CWS fallback

**priceguard-seo**

- `SITE.storeUrls` + `resolveInstallUrlForUa`
- `extensionInstallUrl()` uses it

**priceguard-landing**

- `lib/store-links.ts`, `InstallLink` on Header / Home / Blog CTA

**Still CWS on purpose:** options.html, Telegram, blog article string constants, payment deep link.

---

## After Edge/Yandex publish

Fill in three places (same real URLs/IDs):

1. `priceguard-ai` `STORE_CONFIG.edge|yandex`
2. `priceguard-seo` `SITE.storeUrls` + `extensionIds`
3. `priceguard-landing` `STORE_URLS`

No second builds.
