# MVIDEO-7 — М.Видео reviews feasibility

**Date:** 2026-08-27  
**Verdict:** **SKIP** (do not set `capabilities.reviews = true`)  
**Out of scope:** Telegram / monitoring / Scrappey reviews / fake review strings.

---

## Question

Can ReviewsTab + product-intel collect real M.Video / Eldorado review texts without inventing a fake path or burning Scrappey?

## Evidence

| Path | Result |
|------|--------|
| Extension tab card (MVIDEO-1) | Title/price/article work in **user** Chrome content script — product HTML is reachable without Scrappey for cards. |
| Public / automation browser (Chrome DevTools MCP) | `mvideo.ru/products/smartfon-apple-iphone-15-30066712` → title «Главная», `htmlLen≈2337`, body: *«Запросы… похожи на автоматические»*, `punish=true`. **No review DOM.** |
| Review parsers / selectors | **None** for mvideo or eldorado (`reviews.ts` has no `mvideo` branch). |
| Public reviews JSON / WB-style feedbacks API | Not found / not wired. |
| Scrappey reviews | Extra billable HTML vs MVIDEO-3 **card-only** unlocker — no cost RFC. |

Gate for flip (same as ALI-7 / MEGA-7): live extracted **≥3** real review texts in a **non-automation** user session (or public JSON), without Scrappey.

## Cost / antibot

- **Tab-only in a normal user Chrome** (extension content script, no automation CDP) remains **unvalidated** for reviews — this session’s DevTools browser is blocked by M.Video antibot, so we **cannot** prove ≥3 live review texts.
- Dual-host (eldorado.ru) not separately proven; same network / antibot class expected.
- Flipping `reviews: true` with empty scraper = rejected.

## Decision

| Action | Status |
|--------|--------|
| `registry.capabilities.reviews` mvideo | stays **`false`** |
| M.Video / Eldorado review parsers | **not implemented** |
| ReviewsTab URL paste for mvideo | rejected via `capabilities.reviews` gate in `resolveReviewTarget` |
| Revisit when | User-opened M.Video/Eldorado card (non-automation) shows ≥3 review texts in DOM **or** public reviews JSON **or** Scrappey reviews cost RFC with live success ≥ ~40% |

## Non-goals kept

- No Telegram
- No `monitoring_enabled`
- No fake review strings for AI analysis
- No Scrappey for reviews
