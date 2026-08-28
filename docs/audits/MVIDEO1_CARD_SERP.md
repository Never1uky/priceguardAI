# MVIDEO-1 — Harden M.Video card + SERP

**Date:** 2026-08-27  
**Status:** done (code + unit tests)  
**Out of scope:** Telegram, `monitoring_enabled`, Scrappey unlocker, `enabledByDefault` (stays **false**), SEO publish, Edge Marketplace widen (MVIDEO-5/6).

## What changed

| Area | Change |
|------|--------|
| Card | Dedicated [`src/utils/parsers/mvideo.ts`](../../src/utils/parsers/mvideo.ts): JSON-LD + preferred DOM prices (`.price__main-value`); OOS; brand in title; dual-host mvideo.ru / eldorado.ru |
| SERP | [`scrapeMvideoCandidates`](../../src/utils/parsers/search-results.ts) — product hrefs only; canonical URL; dedupe by article |
| Match | Junk / price-outlier filter via `isAliMegaMarketplace` now includes **mvideo** (parity Mega/Ali) |
| Canonical URL | `toCanonicalProductUrl` — **keep host** (mvideo vs eldorado); strip query/hash; prefer `www.` |
| Wiring | `parsers.ts` routes mvideo/eldorado → dedicated parser; `isGenericCardMarketplace('mvideo') === false` |
| Policy | Defaults WB/Ozon/YM/Mega/Ali unchanged; mvideo `enabledByDefault: false`; unlocker **not** mvideo |

## Tests

```bash
npx vitest run src/utils/parsers/mvideo.test.ts
```

Also: `generic-mp-card.test.ts`, `aliexpress.test.ts` (generic flag), `ali-mega-price-guard.test.ts`.

## Manual smoke (operator)

1. Load unpacked zip after `package:zip`.  
2. Settings: mvideo **off** by default; opt-in works; CORE+Mega+Ali still on.  
3. Open `https://www.mvideo.ru/products/…-{id}` → popup: title, price (or 0 OOS), article, URL without query on www.mvideo.ru.  
4. Open Eldorado `…/cat/detail/…` → same marketplace id `mvideo`, host stays eldorado.ru.  
5. SERP `product-list-page` must **not** parse as product card.  
6. Compare from WB/Ozon phone with mvideo **selected**: furniture/food/dummy-price junk should not win as verified match.  
7. Confirm: no Scrappey unlocker for mvideo; no Telegram path; `monitoring_enabled` untouched.

## Next

Wait for user OK → **MVIDEO-2** (default-on) or skip ahead per plan. MVIDEO-2 stays blocked until explicit approval.
