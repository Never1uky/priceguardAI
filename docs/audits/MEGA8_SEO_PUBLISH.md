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

## Ops note

Do **not** expect a flood of Mega SEO pages: MEGA-7 reviews SKIP → most Mega analyses need long `webOverview` to pass gates. Rejected/draft rows are expected until content quality is real.
