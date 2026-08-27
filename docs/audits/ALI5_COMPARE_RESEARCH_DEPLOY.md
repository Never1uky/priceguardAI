# ALI-5 — Edge `compare-research` includes AliExpress

**Date:** 2026-08-27  
**Out of scope:** Telegram, monitoring cron, inventing Ali HTTP search APIs, research Scrappey verify.

## Behavior

| Piece | Behavior |
|-------|----------|
| **Targets** | `VALID = trio + megamarket + aliexpress` ∩ `targetMarketplaces` (selected/pending). Empty request → all VALID except source. |
| **Source** | `sourceMarketplace: aliexpress` allowed (compare from Ali card → other VALID). |
| **Search** | `searchAliExpress`: try public wholesale HTML; parse `/item/{id}` tiles; else `[]` → client HiddenBrowser (**tab-or-available**). No Scrappey for SERP. |
| **Match** | Same junk/storage gates as Mega (`megaSerpMatchConfidence`). |
| **Scrappey verify** | Ali research top-1 verify **OFF** (`ALI_RESEARCH_SCRAPPEY_VERIFY=false`). ALI-3 = **card unlocker only**; flip flag only after a dedicated cost RFC. |

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
npx supabase functions deploy compare-research --project-ref ihlfvpocwobvcpxbypsd
```

Shared: `marketplace-search-core.ts`, `marketplace-prices.ts` (Ali id extract for optional future verify).

No DB migration.

## Verify

1. Logged-in compare with Ali selected → Edge called with `aliexpress` in `targetMarketplaces`.
2. Antibot Ali SERP → Edge returns empty Ali candidates → extension opens HiddenBrowser Ali SERP.
3. Premium Ali card unlocker still works (ALI-3); research does **not** Scrappey-verify Ali top-1.
4. CORE trio + Mega research unchanged.

## Kill-switch

- Drop `aliexpress` from `COMPARE_RESEARCH_VALID` / client selected, **or**
- Keep Ali in targets but `searchAliExpress` always `[]` (already soft-fails on antibot).
