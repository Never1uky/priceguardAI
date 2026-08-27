# ALI-7 — AliExpress reviews feasibility

**Date:** 2026-08-27  
**Verdict:** **SKIP** (do not set `capabilities.reviews = true`)  
**Out of scope:** Telegram / monitoring.

---

## Question

Can ReviewsTab + product-intel collect real AliExpress.ru review texts without inventing a fake path or burning Scrappey?

## Evidence

| Path | Result |
|------|--------|
| Public HTML card (`aliexpress.ru/item/…`) from non-browser / DC IP | Antibot shell (~1.9 KB, `_____tmd_____/punish` / x5sec). Same class of block that forced ALI-3 **card** Scrappey unlocker. |
| Guessed feedback paths (`…/feedback.html`, `feedback.aliexpress.com/pc/searchEvaluation.do`) | Feedback HTML = punish shell. `searchEvaluation.do` returns **i18n labels / empty ratings chrome** (`numRatings: "0 ratings"`), not usable review texts for a random SKU from DC IP. **No** WB-style open feedbacks API. |
| Existing PriceGuard reviews stack | WB = public API; Ozon = active-tab DOM (+ Edge Scrappey for server intel); YM = HiddenBrowser DOM. Ali has **no** selector path or hidden-tab scraper today; `resolveReviewTarget` messaging is trio-oriented (WB/Ozon/YM). |
| Commercial wrappers / residential review scrapers | Paid proxies — cost ≈ new Scrappey surface, not a free client API. |

## Cost / antibot

- **Tab-only:** possible in theory if the user already has an Ali card open and DOM exposes review text — unvalidated, fragile; preview/full analysis often need HiddenBrowser (YM pattern). Ali card antibot makes hidden-tab success rate poor without Scrappey.
- **Scrappey reviews:** would be **extra** billable HTML vs ALI-3 card-price unlocker (feedback pages / pagination). No cost RFC; ALI-3 was card-only on purpose.
- **Fake / empty reviews:** would light `reviews: true` and return empty / placeholder — rejected by phase rules.

## Decision

| Action | Status |
|--------|--------|
| `registry.capabilities.reviews` Ali | stays **`false`** |
| Ali review parsers / Edge `*-reviews` | **not implemented** |
| ReviewsTab Ali URL | stays unsupported (same as today) |
| Revisit when | Stable public reviews JSON **or** dedicated cost RFC for Scrappey/tab review path with live success rate ≥ ~40% |

## Non-goals kept

- No Telegram
- No `monitoring_enabled`
- No fake review strings for AI analysis
