# MEGA-8 — SEO publishAllowed for Megamarket

**Date:** 2026-08-26  
**Follows:** `docs/SEO_MP_ROLLOUT.md`  
**Out of scope:** Telegram / monitoring / fake reviews.

## Done

1. Adapter READY (MEGA-1…6 card/compare/cache/track).
2. Allowlist mirrors: `publishAllowed` + `offersAllowed` = true for `megamarket`.
3. Migration `20260826200000_megamarket_seo_publish.sql` — CHECK on `seo_product_pages`, `product_cache`, `cross_market_mapping`.
4. Edge `product-url` / `product-id` accept Mega (SEO publish/offers); monitoring key still trio-only.
5. Gates: unit test that Mega is allowlisted but thin analysis still `insufficient_reviews`.

## Deploy (done 2026-08-26)

- Migration applied on prod (`ihlfvpocwobvcpxbypsd`) as `megamarket_seo_publish`.
- Deployed: `seo-publish`, `seo-refresh-offers` (both pick up Mega allowlist + product-id).
- 2026-08-27 volume addendum: redeployed `seo-publish` + `product-intel` (webOverview compose + prompt).

## Ops note

Do **not** expect a flood of Mega SEO pages: MEGA-7 reviews remain **SKIP** (antibot) → almost always `reviewCount < SEO_MIN_REVIEWS` → need `webOverview` ≥ `SEO_MIN_WEB_OVERVIEW_LEN`. Rejected/draft rows are expected until content quality is real. No fake `reviewCount`.

## Addendum — volume strategy (webOverview, 2026-08-27)

Same path as ALI-8 addendum (`docs/audits/ALI8_SEO_PUBLISH.md`):

1. Prompt asks for ≥80-char synthesis `webOverview` without inventing web reviews.
2. Client normalize pads short overview from analysis fields.
3. `seo-publish-run` enriches `webOverview` before gates (compose from qualitySummary / verdict / pros / cons / keySpecs / category axes).
4. Gates / allowlist unchanged — Mega stays publishAllowed; mvideo/dns/… stay off; no product Telegram; no Scrappey reviews for SEO fill.

**Expect:** Mega volume grows only when cloud analysis already has non-thin content; SKIP reviews alone does not invent publishable pages.
