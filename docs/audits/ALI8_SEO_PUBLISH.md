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

## Ops note

Do **not** expect a flood of Ali SEO pages: ALI-7 reviews SKIP → most Ali analyses need long `webOverview` to pass gates. Rejected/draft rows are expected until content quality is real.
