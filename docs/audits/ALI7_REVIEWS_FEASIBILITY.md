# ALI-7 — AliExpress reviews feasibility

**Date:** 2026-08-27 (updated live)  
**Verdict:** **READY (tab DOM)** — `capabilities.reviews = true`  
**Out of scope:** Scrappey reviews, HiddenBrowser Ali reviews, Telegram / monitoring.

---

## Question

Can ReviewsTab + product-intel collect real AliExpress.ru review texts without Scrappey?

## Live evidence (2026-08-27, Chrome DevTools MCP)

| Check | Result |
|-------|--------|
| Card URL | `https://aliexpress.ru/item/1005006524571627.html` (Xiaomi 14) |
| Antibot shell | **No** (`htmlLen` ~1.6MB, `punish=false`) |
| Review nodes | `[class*="RedReviewsProductFeedbackList_ReviewContent__clampedText"]` |
| Unique texts | **10** on first paint (≥3 required); samples are real buyer Russian prose |
| Reviews hub | `…/item/{id}/reviews` link present |
| Scrappey | **not used** |

Gate for flip: live extracted **≥3** real review texts without placeholder.

## Path shipped

| Piece | Status |
|-------|--------|
| `scrapeReviews('aliexpress')` | DOM selectors + optional scroll / `/reviews` click when `allowNavigation` |
| Active / current tab | Same content `SCRAPE_REVIEWS` path as Ozon |
| Hidden tab | **not** added (Ali antibot risk; active card preferred) |
| `resolveReviewTarget` | Ali item URLs accepted |
| `registry.capabilities.reviews` | **true** |

## Still out of scope

- Edge / Scrappey review HTML
- Product Telegram
- Fake review strings

## Revisit

If Ali renames CSS modules and live count drops to 0 — tighten selectors or temporarily flip `reviews: false` again.
