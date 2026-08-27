# P0 Megamarket — implementation report

**Date:** 2026-08-26  
**Version:** 0.9.107 (no bump; `package:release`)  
**Artifact:** `C:\Users\sj480\Projects\priceguard-ai\priceguard-ai-v0.9.107(2).zip`  
**SHA-256:** `80b90913bb18ba589356c72b2a8f2bbbdf7701110a3cf07fdcac76bbc8b3e090`

---

## 1. Marketplace chosen

**`megamarket`** (Мегамаркет). Hosts: `megamarket.ru` + `sbermegamarket.ru` (one ID).

## 2. Why

Furthest along: dedicated card parser, tab adapter, SERP branch, `costTier: 'tab'`, `enabledByDefault: false`, unlocker/Scrappey/monitoring off. «СберМегаМаркет» is the same adapter — not a second product.

## 3. Files changed

| File | Change |
|------|--------|
| `src/utils/parsers/megamarket.ts` | Brand→title, schema.org OOS, seller scrape helper |
| `src/utils/parsers/search-results.ts` | Canonical SERP URLs, article required, no search-shell candidates |
| `src/content/index.ts` | Seller → `pageMeta.specs`; generic error copy |
| `src/utils/parsers/megamarket.test.ts` | **New** — detect/URL/ID/parser/SERP/match/cache/defaults |
| `src/utils/product-url.test.ts` | Sber→mega canonical case |
| `supabase/migrations/20260826140000_megamarket_tracked_check.sql` | **New** — widen tracked + price history CHECK |
| `docs/audits/P0_MARKETPLACE_MEGAMARKET_REPORT.md` | This report |

Unchanged by design: manifest (already matched), registry defaults, cost-guards, SEO `publishAllowed`, agent-orchestrator, Scrappey allowlists.

## 4. Migrations

**`20260826140000_megamarket_tracked_check.sql`**

Tables:

- `tracked_products` — allow `megamarket`
- `product_price_history` — allow `megamarket`

Additive CHECK only. Does **not** flip `marketplace_flags`, monitoring, or Scrappey lists.

**Not widened (P2/P3):** `price_scrape_cache`, `product_cache`, SEO, cross_market_mapping, telegram sessions, search_metrics, …

## 5. API / search / parser

| Layer | Mechanism |
|-------|-----------|
| Search API | **None** — `searchMegamarket` returns tab-only stub |
| Real search | HiddenBrowser / visible tab SERP → `scrapeMegamarketCandidates` |
| Card | Content script → `parseMegamarketProduct` (JSON-LD → DOM) |
| Search URL | `https://megamarket.ru/catalog/?q=…` |

## 6. Fallback

`searchMarketplaceWithFallback` → API stub (not found) → tab SERP → candidate match (`product-match`) → optional card cascade verify → manual pick. Refresh: `fetchOfferViaApi` = null → HiddenBrowser scrape → unlocker **skipped** (`not_core`).

## 7. Scrappey usage (megamarket)

| Scenario | Scrappey? |
|----------|-----------|
| Free search/compare | **No** |
| Premium search/compare | **No** |
| Refresh / client cache miss | **No** |
| Shared server cache hit/miss | **No** (no Mega server cache path) |
| compare-research | **No** (VALID = trio) |
| Telegram /add & update-prices | **No** |
| Repeat search | **No** |

## 8. Cost guard

- Registry `costTier: 'tab'`
- `premium-unlocker-offer` excludes megamarket
- `cost-guards.parseMpList` drops non-trio → Mega cannot enter `scrappey_marketplaces` / monitoring list via env
- Seed: `marketplace_enabled=false`, `monitoring_enabled=false`

## 9. Enable / disable

1. Settings «Где искать» — opt-in checkbox (non-core)  
2. Server `marketplace_flags.megamarket.marketplace_enabled` must be true or selection is stripped  
3. Defaults remain WB/Ozon/YM — old users do **not** get Mega unless they opt in **and** ops enables the flag  

Ops: `supabase/scripts/set-marketplace-flags.sql` (compare-only; monitoring stays false).

## 10. Compare path

`getSelectedSearchMarketplaces()` → if Mega selected + flag on → `compare-offers` draws slot → tab search/match → table / CandidatePicker.

## 11. Cache

- Client SERP/compare keys use marketplace + identity (article/URL).  
- Review cache: `mp:megamarket:{article}`.  
- Server `price_scrape_cache` / `product_cache` still trio CHECK — Mega does not write those in P0.

## 12. Telemetry

Ops/funnel events accept `marketplace=megamarket` (`telemetry_events` already widened). Compare/search stages emit marketplace string from selected MP.

## 13. Tests added

`src/utils/parsers/megamarket.test.ts` (+ product-url sber case): detect, canonical URL, article, parser happy/OOS/malformed, seller, SERP candidates/empty/dedupe/sber rewrite, matching via `scoreProductMatch`, cache key, defaults/unlocker, trio regression smoke.

Existing: compare-offers marketplaces, search-settings, unlocker, compare-research-targets, SEO publishAllowed false.

## 14. Tests / gates passed

- `npm test` — **954 passed**, 13 skipped (live e2e)  
- `npm run build` — OK  
- `npm run package:release` — validate-zip OK  
- `npm run qa:preflight` — 29/29  

## 15. Unresolved

- Live DOM/SERP selector drift not validated in DevTools this pass (fixtures only).  
- Brand/seller not first-class `Product` fields (title + `pageMeta.specs`).  
- Edge research / agent / SEO publish still exclude Mega.  
- ~10 other DB CHECKs still trio-only.  
- Server matching for Mega N/A (no Edge target).

## 16. Scaling issues for next MPs

- **12+ marketplace CHECK constraints** — each new MP needs many migrations; fragile.  
- Edge `Marketplace` type and Scrappey/cost-guards hard-coded to trio.  
- Duplicate registries (client / Edge / SEO mirrors).  
- Generic card adapters thinner than Mega — higher live failure risk.

## 17. P1 / P2 backlog

1. Durable marketplace allowlist strategy (enum table or shared CHECK helper) — don’t hand-edit 12 constraints per MP.  
2. Port attribute matching to Edge research if Mega becomes a research target.  
3. Optional Scrappey/server fetch only behind explicit monitoring + cost flags.  
4. SEO `publishAllowed` when content quality READY.  
5. `agent-orchestrator` `ALL_MARKETPLACES` expansion.  
6. Native `Product.brand` / `seller` if product needs them beyond title/specs.  
7. Live DevTools hardening loop for Mega SERP/card.

---

## Definition of done checklist

- [x] Opt-in client compare path for Mega (candidates = product cards)  
- [x] Tracked CHECK allows `megamarket`  
- [x] Defaults / monitoring / Scrappey unchanged  
- [x] Tests + build + package:release + qa:preflight green  
- [x] No CWS/Edge publish, no version bump, no separate manifest  
