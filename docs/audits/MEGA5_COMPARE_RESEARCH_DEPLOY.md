# MEGA-5 — Edge `compare-research` includes Megamarket

**Date:** 2026-08-26  
**Out of scope:** Telegram, monitoring cron, inventing Mega HTTP search APIs.

## Behavior

| Piece | Behavior |
|-------|----------|
| **Targets** | `VALID = trio + megamarket` ∩ `targetMarketplaces` (selected/pending). Empty request → all VALID except source. |
| **Source** | `sourceMarketplace: megamarket` allowed (compare from Mega card → trio). |
| **Search** | `searchMegamarket`: try public catalog HTML; parse tiles; else `[]` → client HiddenBrowser (**tab-or-available**). No Scrappey for SERP. |
| **Match** | `megaSerpMatchConfidence` — junk category / storage gates (not blind `scoreTitle`). |
| **Scrappey verify** | Mega research top-1 verify **OFF** (`MEGA_RESEARCH_SCRAPPEY_VERIFY=false`). MEGA-3 = **card unlocker only**; flip flag only after a dedicated cost RFC. |

## Deploy (prod `ihlfvpocwobvcpxbypsd`)

```bash
npx supabase functions deploy compare-research --project-ref ihlfvpocwobvcpxbypsd
```

Shared: `marketplace-search-core.ts`, `marketplace-prices.ts` (Mega id extract for optional future verify).

No DB migration.

## Verify

1. Logged-in compare with Mega selected → Edge called with `megamarket` in `targetMarketplaces`.
2. Antibot Mega SERP → Edge returns empty Mega candidates → extension opens HiddenBrowser Mega SERP.
3. Premium Mega card unlocker still works (MEGA-3); research does **not** Scrappey-verify Mega top-1.
4. CORE trio research unchanged.

## Kill-switch

- Drop `megamarket` from `COMPARE_RESEARCH_VALID` / client selected, **or**
- Keep Mega in targets but `searchMegamarket` always `[]` (already soft-fails on antibot).
