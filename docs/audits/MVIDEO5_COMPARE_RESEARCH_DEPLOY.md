# MVIDEO-5 — Edge `compare-research` includes М.Видео

**Date:** 2026-08-27  
**Out of scope:** Telegram, monitoring cron, inventing M.Video HTTP search APIs, research Scrappey verify.

## Behavior

| Piece | Behavior |
|-------|----------|
| **Targets** | `VALID = trio + megamarket + aliexpress + mvideo` ∩ `targetMarketplaces` (selected/pending). Empty request → all VALID except source. |
| **Source** | `sourceMarketplace: mvideo` allowed (compare from M.Video / Eldorado card → other VALID). |
| **Search** | `searchMvideo`: try public `product-list-page` HTML; parse `/products/…{id}` (+ Eldorado paths); else `[]` → client HiddenBrowser (**tab-or-available**). No Scrappey for SERP. |
| **Match** | Same junk/storage gates as Mega/Ali (`megaSerpMatchConfidence`). |
| **Scrappey verify** | M.Video research top-1 verify **OFF** (`MVIDEO_RESEARCH_SCRAPPEY_VERIFY=false`). MVIDEO-3 = **card unlocker only**; flip flag only after a dedicated cost RFC. |

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
npx supabase functions deploy compare-research --project-ref ihlfvpocwobvcpxbypsd
```

Shared: `marketplace-search-core.ts`, `marketplace-prices.ts` (mvideo id extract for optional future verify).

No DB migration.

## Verify

1. Logged-in compare with mvideo selected → Edge called with `mvideo` in `targetMarketplaces`.
2. Antibot M.Video SERP → Edge returns empty mvideo candidates → extension opens HiddenBrowser M.Video SERP.
3. Premium mvideo card unlocker still works (MVIDEO-3); research does **not** Scrappey-verify mvideo top-1.
4. CORE trio + Mega + Ali research unchanged.

## Kill-switch

- Drop `mvideo` from `COMPARE_RESEARCH_VALID` / client selected, **or**
- Keep mvideo in targets but `searchMvideo` always `[]` (already soft-fails on antibot).
