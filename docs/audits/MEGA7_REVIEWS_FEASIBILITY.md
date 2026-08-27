# MEGA-7 — Megamarket reviews feasibility

**Date:** 2026-08-26  
**Verdict:** **SKIP** (do not set `capabilities.reviews = true`)  
**Out of scope:** Telegram / monitoring.

---

## Question

Can ReviewsTab + product-intel collect real Mega review texts without inventing a fake path or burning Scrappey?

## Evidence

| Path | Result |
|------|--------|
| Public HTML card (`megamarket.ru/catalog/details/…`) from non-browser / DC IP | Antibot shell (~1.8 KB, `noscript` → challenge). Same class of block that forced MEGA-3 **card** Scrappey unlocker. |
| Guessed mobile review APIs (`/api/mobile/v1/reviewsList`, `productReviews`, `/api/market/v2/reviews`) | No usable JSON: geo/VPN deny payload or same antibot HTML. **No WB-style open feedbacks API.** |
| Commercial wrappers (parse.bot `get_product_reviews`, Apify Mega reviews) | Paid scrapers / residential proxies — cost ≈ new Scrappey surface, not a free client API. |
| Existing PriceGuard reviews stack | WB = public API; Ozon = active-tab DOM (+ Edge Scrappey for server intel); YM = HiddenBrowser DOM. Mega has **no** selector path or hidden-tab scraper today; `resolveReviewTarget` trio-only. |

## Cost / antibot

- **Tab-only:** possible in theory if user already has a Mega card open and DOM exposes review text — unvalidated, fragile, and preview/full analysis often need HiddenBrowser (YM pattern). Mega card antibot makes hidden-tab success rate poor without Scrappey.
- **Scrappey reviews:** would be **extra** billable HTML vs MEGA-3 card-price unlocker (reviews pages / pagination). No cost RFC; MEGA-3 was card-only on purpose.
- **Fake / empty reviews:** would light `reviews: true` and return empty / placeholder — rejected by phase rules.

## Decision

| Action | Status |
|--------|--------|
| `registry.capabilities.reviews` Mega | stays **`false`** |
| Mega review parsers / Edge `*-reviews` | **not implemented** |
| ReviewsTab Mega URL | stays unsupported (same as today) |
| Revisit when | Stable public reviews JSON **or** dedicated cost RFC for Scrappey/tab review path with live success rate ≥ ~40% |

## Non-goals kept

- No Telegram
- No `monitoring_enabled`
- No fake review strings for AI analysis
