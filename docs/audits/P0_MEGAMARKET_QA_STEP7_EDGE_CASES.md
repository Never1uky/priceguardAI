# STEP 7 — Error / edge-case audit (Megamarket)

**Date:** 2026-08-26  
**Scope:** Mega parser/SERP/compare error handling + isolation so one MP failure does not break CORE/others.  
**Evidence:** code review + unit tests (`megamarket.test.ts`, `compare-service`, `empty-scrape-guard`, `compare-table-rows`) — **29 passed** this session.  
**No code changes.**

---

## Isolation (critical)

| Mechanism | Behavior |
|-----------|----------|
| `resolveTarget(mp)` | Per-MP `try/catch` → `notFoundOffer(..., 'Ошибка загрузки')` — never rethrows |
| `mapPool(..., COMPARE_MARKETPLACE_CONCURRENCY=2)` | Workers run independently; Mega throw contained in `resolveTarget` |
| `empty-scrape-guard` | Counters keyed `marketplace:kind` — Mega empty does **not** skip WB/Ozon/YM tabs |
| `researchSingleMarketplace` | Clears **only** target slot; keeps other offers (`compare-service.test.ts`) |
| Edge research | Mega stripped from targets — Edge failure on trio does not depend on Mega |

**Verdict:** Mega failure **does not abort** multi-MP compare. Other slots continue.

---

## Edge-case matrix (Megamarket)

| Case | Expected | Actual (code) | Tests | Severity if gap |
|------|----------|---------------|-------|-----------------|
| **Товар не найден** (empty SERP / no match) | `not_found` offer for Mega only | `notFoundOffer` / empty candidates → needs_choice or not_found | SERP empty unit; compare `not_found` rows | — |
| **Цена отсутствует** (title OK, price 0, not OOS) | Soft: product/offer without price; not crash | Card returns `price: 0`, `availability: undefined`; refresh → null / not priced | Partial (DOM price path) | **P2** — may look like “нет цены” vs OOS ambiguity |
| **Цена меняется** | New scrape updates offer; alerts if tracked | Refresh/HB re-scrape; tracked `updateTrackedProductPrice` | CORE paths; Mega via same refresh | Live **BLOCKED** |
| **OOS** | `availability: out_of_stock`, price 0 | LD `OutOfStock` **or** (price≤0 ∧ OOS text) | Unit: schema.org OOS | — |
| **Seller отсутствует** | Optional; no crash | `scrapeMegamarketSellerFromDom` → null; specs omit seller | Unit seller when present | — |
| **Brand отсутствует** | Title as-is; matching still runs | `titleWithBrand` no-op without brand | Unit prepend when present | — |
| **schema.org отсутствует** | DOM fallback | `parseJsonLdProduct` null → h1/og + DOM price | Unit DOM price | — |
| **Malformed JSON-LD** | Skip bad script, try next / DOM | `JSON.parse` in try/catch per script | Implicit via catch | **P3** no dedicated malformed LD fixture |
| **Canonical / sber host** | Rewrite to megamarket.ru, strip query | `toCanonicalProductUrl` | Unit | — |
| **Canonical fail (bad URL)** | Soft strip `?`/`#` | `catch` in `toCanonicalProductUrl` | — | Low |
| **Article отсутствует** | No SERP candidate; card id fallback | SERP requires `extractComparisonArticle`; card `id: megamarket:${url}` with `article: ''` | Unit skip bad article; card allows empty article | **P2** weak identity if details URL without digits |
| **MP временно недоступен** (blank/antibot page) | Mega `not_found` / empty scrape; others OK | Empty title → `parseMegamarketProduct` null → tab fail → empty budget → skip Mega only | Isolation via per-MP catch | Live antibot common |
| **Timeout** (tab load / softFail) | Soft fail Mega slot | HB `softFail: true`; wait/delay; catch → not_found | — | **P2** no Mega-specific timeout unit |
| **Malformed response / unexpected HTML** | null product or empty SERP; no throw | Selectors miss → null/empty; LD catch | null without title; empty SERP | — |
| **SERP as product card** | Must not | `isProductPage` / parse requires `/catalog/details/` | Unit | — |

---

## Per-case notes

### Not found
Search stub + tab SERP with zero candidates → finalize to `not_found` / manual pick empty. Slot-local.

### Missing price
If title parses but price stays 0 and OOS heuristics false → product returned with `price: 0` and **no** `availability`. Downstream may treat as empty card / not offer-with-price rather than explicit OOS. Acceptable soft behavior; distinguish from OOS when heuristics fire.

### Price change
Same cascade as CORE refresh (HB for Mega). No Scrappey. Client tracked alerts possible; server cron does not monitor Mega.

### OOS
Covered by schema.org + RU phrases. Price forced to 0.

### Seller / brand missing
Non-blocking. Brand only improves title for matching when LD present.

### No schema.org
DOM path required for live Mega — fragile to layout churn (**P1 live** if selectors break, not a logic bug).

### No article
SERP correctly rejects. Card can still scrape with empty `article` and URL-based `id` — matching/cache weaker (**P2**).

### Unavailable / timeout / bad HTML
Contained in Mega resolve path; empty-scrape budget is per-MP.

---

## Cross-MP failure isolation diagram

```text
compare: [WB, Ozon, YM, Mega]
              │
         mapPool(concurrency=2)
              │
     ┌────────┴────────┐
  resolveTarget(WB)  resolveTarget(Mega) …
     │                    │
   success              throw/empty
     │                    │
  offer WB OK     catch → not_found Mega
     │                    │
     └──────── merge ─────┘
              │
     WB/Ozon/YM offers preserved
```

---

## Findings by severity

### P0 BLOCKER
None identified in isolation / soft-fail design.

### P1 HIGH
| | |
|--|--|
| **Live DOM/antibot** | Unexpected HTML / blank Mega page → empty scrape; **logic OK**, but live QA still needed to confirm selectors on real pages |
| **Not a code isolation bug** | — |

### P2 MEDIUM
1. Price=0 without OOS signal → ambiguous vs true OOS.  
2. Card with empty article still returned (weak id).  
3. No dedicated unit for malformed JSON-LD / tab timeout.

### P3 LOW
4. Add fixtures: broken LD script + garbage body; assert null/empty without throw.

---

## Minimal fix proposals (do **not** apply unless approved)

1. If `price <= 0` and no OOS → prefer `availability: undefined` + treat as scrape-empty sooner (already mostly null on refresh).  
2. Require non-empty `article` for successful Mega **card** parse (align with SERP) — stricter, may false-negative odd URLs.  
3. Unit: malformed LD; mapPool isolation test (Mega reject, Ozon priced).

---

## Verdicts (Step 7)

| Gate | Result |
|------|--------|
| Soft-fail Mega errors | **PASS** (code) |
| One MP error ≠ break others | **PASS** |
| Covered edge cases (unit) | **PASS** for main paths; gaps P2/P3 above |
| Live unexpected HTML | **NOT VERIFIED** (automation antibot) |

**ERROR / EDGE CASE: PASS (design + unit)** with live selector risk noted.
