# MVIDEO-8 — SEO publishAllowed for М.Видео

**Date:** 2026-08-28  
**Follows:** `docs/SEO_MP_ROLLOUT.md`  
**Out of scope:** Telegram / monitoring / fake reviews.

## Done

1. Adapter READY (MVIDEO-1…7 card/compare/cache/track/research; reviews SKIP).
2. Allowlist mirrors: `publishAllowed` + `offersAllowed` = true for `mvideo` (extension + Edge).
3. Migration `20260828100000_mvideo_seo_publish.sql` — CHECK on `seo_product_pages`, `product_cache`, `cross_market_mapping`.
4. Edge `product-id` / `product-url` already accept mvideo (MVIDEO-6); monitoring key still trio-only.
5. Gates: unit test that mvideo is allowlisted but thin analysis still `insufficient_reviews`.

## Deploy

```bash
# Migration (applied via MCP as mvideo_seo_publish)
# File: supabase/migrations/20260828100000_mvideo_seo_publish.sql

npx supabase functions deploy seo-publish --project-ref ihlfvpocwobvcpxbypsd
npx supabase functions deploy seo-refresh-offers --project-ref ihlfvpocwobvcpxbypsd
```

Sync external mirror when applicable: `priceguard-seo/src/lib/seo-marketplaces.ts`.

## Ops note

Do **not** expect a flood of M.Video SEO pages: MVIDEO-7 reviews **SKIP** (antibot) → almost always `reviewCount < SEO_MIN_REVIEWS` → need `webOverview` ≥ `SEO_MIN_WEB_OVERVIEW_LEN`. Rejected/draft rows are expected until content quality is real. No fake `reviewCount`.

## Addendum — volume strategy (webOverview)

Same path as MEGA-8 / ALI-8 addenda:

1. Prompt asks for ≥80-char synthesis `webOverview` without inventing web reviews.
2. Client normalize pads short overview from analysis fields.
3. `seo-publish-run` enriches `webOverview` before gates (compose from qualitySummary / verdict / pros / cons / keySpecs / category axes).
4. Gates / allowlist unchanged — mvideo stays publishAllowed; dns/citilink/lamoda stay off; no product Telegram; no Scrappey reviews for SEO fill.

**Expect:** M.Video volume grows only when cloud analysis already has non-thin content; SKIP reviews alone does not invent publishable pages.
