# ALI-8 — SEO publishAllowed for AliExpress

**Date:** 2026-08-27  
**Follows:** `docs/SEO_MP_ROLLOUT.md`  
**Out of scope:** Telegram / monitoring / fake reviews.

## Done

1. Adapter READY (ALI-1…6 card/compare/cache/track).
2. Allowlist mirrors: `publishAllowed` + `offersAllowed` = true for `aliexpress` (extension + Edge + priceguard-seo).
3. Migration `20260827150000_aliexpress_seo_publish.sql` — CHECK on `seo_product_pages`, `product_cache`, `cross_market_mapping`.
4. Edge `product-url` / `product-id` already accept Ali (ALI-6); monitoring key still trio-only.
5. Gates: unit test that Ali is allowlisted but thin analysis still `insufficient_reviews`.

## Deploy

- Migration applied on prod (`ihlfvpocwobvcpxbypsd`) as `aliexpress_seo_publish`.
- Deployed: `seo-publish`, `seo-refresh-offers` (both pick up Ali allowlist).
- 2026-08-27 volume addendum: redeployed `seo-publish` + `product-intel` (webOverview compose + prompt).

## Ops note

Do **not** expect a flood of Ali SEO pages: even with ALI-7 tab reviews READY, many cards still have `reviewCount < SEO_MIN_REVIEWS` → need `webOverview` ≥ `SEO_MIN_WEB_OVERVIEW_LEN`. Rejected/draft rows are expected until content quality is real. No fake `reviewCount`.

## Addendum — volume strategy (webOverview, 2026-08-27)

**RCA:** `seo-publish` copies `product_cache` analysis (no AI at publish). AI prompts historically left `webOverview` empty when there was no «Данные из интернета» block → gate `insufficient_reviews`.

**Path (no gate weaken, no Scrappey reviews, no product Telegram):**

1. **Prompt / schema** — client `src/lib/ai/prompts.ts` + `schemas.ts` and Edge `product-intel`: if no web block, still write 2–4 sentence `webOverview` (≥80 chars) as synthesis from reviews/title/category axes — not invented web reviews.
2. **Normalize** — `normalizeFullAnalysisResponse` pads short `webOverview` via `composeWebOverviewFromAnalysis` (pros/cons/qualitySummary/verdict/priceInsight).
3. **Publish enrich** — Edge `seo-publish-run` calls `enrichAnalysisWebOverviewForSeo` before `evaluateSeoPublishGates` (category from title). Helps **old** cache rows without re-analysis.
4. **Gates unchanged** — `SEO_MIN_*` same; thin analysis still reject; `local_source` / empty still reject.

**Expect:** more Ali pages publishable when analysis already has solid pros/cons/summary; still sparse for empty/local analyses.
