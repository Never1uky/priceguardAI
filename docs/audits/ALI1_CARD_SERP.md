# ALI-1 — Harden AliExpress card + SERP

**Date:** 2026-08-27  
**Status:** done (code + unit tests)  
**Out of scope:** Telegram, `monitoring_enabled`, Scrappey unlocker, `enabledByDefault` (stays **false**), SEO publish.

## What changed

| Area | Change |
|------|--------|
| Card | Dedicated [`src/utils/parsers/aliexpress.ts`](../../src/utils/parsers/aliexpress.ts): JSON-LD + embedded/runParams-ish walk + DOM; OOS; brand in title |
| SERP | [`scrapeAliExpressCandidates`](../../src/utils/parsers/search-results.ts) — `/item/{8+digits}` only, canonical URL, dedupe by article |
| Match | Junk filter (category + score>0) extended to **aliexpress** (same as Mega) in `pickSearchFromCandidates` |
| Canonical URL | `toCanonicalProductUrl` → `https://aliexpress.ru/item/{id}.html` |
| Adapter | Stricter article/product/SERP patterns; still test/opt-in |
| Wiring | `parsers.ts` routes Ali to dedicated parser; `isGenericCardMarketplace('aliexpress') === false` |
| Policy | Defaults WB/Ozon/YM/Mega unchanged; Ali `enabledByDefault: false`; unlocker **not** Ali |

## Tests

```bash
npx vitest run src/utils/parsers/aliexpress.test.ts
```

Also keep Mega junk tests green: `src/lib/mega-serp-match.test.ts`.

## Manual smoke (operator)

1. Load unpacked build (after you request `package:zip`).  
2. Settings: Ali **off** by default; opt-in works; CORE+Mega still on.  
3. Open `https://aliexpress.ru/item/{id}.html` → popup: title, price (or 0 OOS), article, URL without query on `aliexpress.ru`.  
4. Wholesale SERP tab must **not** parse as product card.  
5. Compare from WB/Ozon phone with Ali **selected**: Mega-like junk (furniture/food/case) should not win as verified match; offer or needs_choice / not_found OK.  
6. Confirm: no Scrappey unlocker call for Ali; no Telegram path for Ali.

## Next

Wait for user OK → **ALI-2** (default-on) or skip to **ALI-6** (`ae-` identity) per plan. ALI-2 stays blocked until explicit approval.
