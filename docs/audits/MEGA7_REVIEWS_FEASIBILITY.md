# MEGA-7 — Megamarket reviews feasibility

**Date:** 2026-08-26 (revisit 2026-08-27)  
**Verdict:** **SKIP** (do not set `capabilities.reviews = true`)  
**Out of scope:** Telegram / monitoring / Scrappey reviews.

---

## Question

Can ReviewsTab + product-intel collect real Mega review texts without inventing a fake path or burning Scrappey?

## Evidence

| Path | Result |
|------|--------|
| Public HTML card from non-browser / DC IP | Antibot shell (~1.8 KB). Same class that forced MEGA-3 **card** Scrappey unlocker. |
| Guessed mobile review APIs | No usable JSON. **No** WB-style open feedbacks API. |
| Commercial wrappers | Paid — cost ≈ Scrappey surface. |
| **Live revisit 2026-08-27 (Chrome DevTools MCP)** | `megamarket.ru/catalog/details/smartfon-100067205836/` → page title **«Упс…»**, body: *«запросы с вашего устройства похожи на автоматические»*, `htmlLen≈3708`, `punish=true`. Same block on `/catalog/`. **No review DOM to scrape.** |

## Cost / antibot

- **Tab-only in a normal user Chrome** (extension content script, no automation CDP) remains **unvalidated** — this session’s DevTools browser is blocked by Mega antibot, so we **cannot** prove ≥3 live review texts.
- **Scrappey reviews:** extra billable HTML vs MEGA-3 card-only unlocker — no cost RFC.
- Flipping `reviews: true` with empty scraper = rejected.

## Decision

| Action | Status |
|--------|--------|
| `registry.capabilities.reviews` Mega | stays **`false`** |
| Mega review parsers | **not implemented** |
| ReviewsTab Mega URL | rejected via `capabilities.reviews` gate in `resolveReviewTarget` |
| Revisit when | User-opened Mega card (non-automation) shows ≥3 review texts in DOM **or** public reviews JSON **or** Scrappey reviews cost RFC with live success ≥ ~40% |

## Non-goals kept

- No Telegram
- No `monitoring_enabled`
- No fake review strings for AI analysis
- No Scrappey for reviews
