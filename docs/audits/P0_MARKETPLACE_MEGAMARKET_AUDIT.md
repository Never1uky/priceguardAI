# P0 Marketplace — read-only audit (before implementation)

**Date:** 2026-08-26  
**Scope:** Choose **one** new marketplace for full end-to-end completion.  
**Rule:** `host_permissions` ≠ implementation. Do not claim support without adapter + parse + search + compare path + tests.

---

## Correction to the stated audit

The inventory below shows the **incoming audit is partially outdated**. In this repo today:

| Claim | Actual |
|-------|--------|
| `Marketplace` only trio | **False** — `MarketplaceId` includes megamarket, aliexpress, mvideo, dns, citilink, lamoda (`src/lib/marketplaces/registry.ts`); `Marketplace` aliases it |
| `detectMarketplace` only trio | **False** — loops `TAB_SEARCH_ADAPTERS` (`src/utils/marketplace.ts`) |
| `content_scripts` only trio | **False** — manifest matches include Megamarket, Ali, MVideo, DNS, Citilink, Eldorado, Lamoda |
| New domains only in host_permissions | **Incomplete** — registry + adapters + some parsers/SERP exist; **server/DB/agent/SEO publish** still trio-centric |
| `agent-orchestrator` only trio | **True** — `ALL_MARKETPLACES = WB/Ozon/YM` |
| DB CHECKs only trio | **Mostly true** — many tables still CHECK trio; `marketplace_flags` / telemetry ops allowlist already name extra MPs |

**Verdict on “not implemented”:** fair for **production-complete** (server monitoring, SEO publish, agent shopping, DB writes). Unfair for **client compare scaffolding** — especially **Megamarket**, which is furthest along as a tab adapter.

---

## P0 choice: **Мегамаркет** (`megamarket`)

Treat **СберМегаМаркет** as the **same** marketplace (`megamarket` id; hosts `megamarket.ru` \| `sbermegamarket.ru`) — already in adapter. Do **not** ship a second id.

### Why Megamarket first

| Criterion | Megamarket | Others |
|-----------|------------|--------|
| Dedicated card parser | `src/utils/parsers/megamarket.ts` | Ali/DNS/… mostly `generic-mp-card` |
| Tab adapter + article/SERP | First entry in `adapter-config.ts` | Present but thinner |
| SERP extract branch | `search-results.ts` `case 'megamarket'` | Partial / generic |
| Canonical URL | Special-cased in `product-url.ts` | Less mature |
| Tests | search-settings, compare-offers, safe-url, SEO slug | Fewer live-quality asserts |
| Cost | `costTier: 'tab'` — **no Scrappey** (fits cost guards) | Same for other test MPs |
| Antibot | Hard but local; no new Scrappey spend for P0 | AliExpress typically worse |
| Product decision | Flags: compare can be enabled; monitoring defaults **off** | Same |

### Why not first

| Candidate | Reason to defer |
|-----------|-----------------|
| СберМегаМаркет | Already aliased into `megamarket` |
| AliExpress | Harder SERP/antibot; weaker card identity |
| М.Видео / Эльдорадо | Dual-host `mvideo` id; more URL shapes |
| DNS / Ситилинк | Generic parser only; electronics SERP noise |
| Ламода | Fashion matching risk; category gates |

**P0 goal (after this audit):** finish Megamarket **client compare** end-to-end (detect → card → SERP → match → table → refresh) + **DB CHECK widen where tracked/cache needs it** + flags/docs/QA. Explicitly **out of P0:** Scrappey monitoring, SEO `publishAllowed`, agent-orchestrator shopping across Megamarket (unless tiny unblock).

---

## Touchpoint map (30)

Legend: **Req** = required for Megamarket P0 compare E2E · **Later** = monitoring/SEO/agent · **Done** = already sufficient for P0 scaffolding

| # | Area | File(s) | Symbol / const | What to change | Req? | Layer | Risk |
|---|------|---------|----------------|----------------|------|-------|------|
| 1 | Marketplace type | `src/lib/marketplaces/registry.ts`, `src/types/product.ts` | `MarketplaceId`, `Marketplace` | Already includes `megamarket` | **Done** | client | Low — don’t redefine |
| 2 | Registry | `registry.ts` | `MARKETPLACES` megamarket entry | Confirm `supported: true`, default off; maybe rename “test” notes in docs | Soft | client | Low |
| 3 | detectMarketplace | `src/utils/marketplace.ts` | `detectMarketplace` | Already maps via adapter hosts | **Done** | client | Low |
| 4 | URL normalization | `src/utils/product-url.ts`, `comparison-url.ts` | `toCanonicalProductUrl` | Harden megamarket details URL (query strip, sber→mega host) if live fails | **Req** if bugs | client | Med — bad keys break cache/match |
| 5 | Product ID extraction | `marketplace.ts` `extractArticle` + adapter `extractArticle` | digits from `/catalog/details/…` | Validate live URLs (slug+id vs bare id) | **Req** | client | High if wrong id |
| 6 | content_scripts.matches | `manifest.json` | megamarket/sber catalog matches | Already present; align if live paths differ (`/catalog/details/` only?) | Soft | client | Med — CS not injecting |
| 7 | host_permissions | `manifest.json` | megamarket + sber hosts | Already present — **not** proof of E2E | Done for perms | client | CWS disclosure already notes opt-in |
| 8 | Parser / product page | `parsers/megamarket.ts`, `parsers.ts` | `parseMegamarketProduct` | Live DOM/JSON-LD harden; OOS; image | **Req** | client | High — empty price = dead MP |
| 9 | Search parser | `parsers/search-results.ts` | megamarket SERP extract | Live SERP selectors; empty/captcha | **Req** | client | High |
| 10 | Search fallback | `marketplace-search.ts`, `compare-tab-search.ts` | megamarket search URL / HiddenBrowser | Ensure tab path runs; no silent skip | **Req** | client | Med |
| 11 | Matching | `product-match.ts`, category plugins | title/brand/model rules | Megamarket title noise; false matches | **Req** | client | High trust |
| 12 | Compare pipeline | `compare-service.ts`, `compare-offers.ts`, `marketplace-search.ts` | offer slots for all selected MPs | Verify megamarket fills table when selected + flag on | **Req** | client | Med |
| 13 | Refresh pipeline | `product-page-fetch.ts`, card cascade | tab scrape for megamarket | No unlocker (not Scrappey MP) | **Req** | client | Med |
| 14 | Tracked products | `storage.ts`, `tracked-sync` Edge | upsert marketplace text | **DB CHECK** may reject `megamarket` on cloud sync | **Req** if track from mega | client+DB | **High** — sync fails |
| 15 | Product / price cache | `price_scrape_cache`, AI `product_cache` | marketplace column CHECKs | Widen CHECK if writing mega rows | **Req** if cache write | DB+Edge | High |
| 16 | Cross-market mapping | migrations `cross_market_mapping`, match-feedback | source/target CHECK trio | Widen or keep mega **local-only** match (no shared map) | Later / optional P0 | DB | Med — mapping inserts fail |
| 17 | AI analysis / cache keys | `product_cache`, ai pipeline | marketplace in key | Works if type accepts mega; DB CHECK may block cloud cache | Soft | client+DB | Med |
| 18 | agent-orchestrator | `supabase/functions/_shared/agent-orchestrator.ts` | `ALL_MARKETPLACES` | Still trio — **out of P0** unless agent must search mega | Later | Edge | Low for compare-only P0 |
| 19 | compare-research | `compare-research/index.ts` + client targets | VALID targets trio | Edge research **skips** megamarket by design (`compare-research-targets.test.ts`) — client tab search must carry mega | **Req** awareness | Edge+client | Med — expect no Edge SERP for mega |
| 20 | Telegram alerts | `telegram-webhook`, `update-prices`, `marketplace-prices.ts` | `Marketplace = trio` only | Monitoring **off** by flag; don’t enable Scrappey for mega in P0 | Later | Edge | High cost if wrongly enabled |
| 21 | Telemetry | `ops.ts`, ingest allowlist | megamarket already in some allowlists | Emit `marketplace=megamarket` on compare attempts | Soft | client+Edge | Low |
| 22 | Marketplace selection UI | Settings «Где искать» | registry-driven | Already lists mega; gate by server flags | Soft | UI | Low |
| 23 | Settings | `search-settings.ts`, `server-flags.ts` | filter by `marketplace_enabled` | Ops: set `marketplace_flags.megamarket.marketplace_enabled=true` for pilot | **Req** ops | UI+DB | Without flag, saves strip mega |
| 24 | SEO marketplace registry | `seo-marketplaces.ts` (×3 mirrors) | `publishAllowed: false` | Keep **false** for P0 | Later | SEO | Don’t index until READY |
| 25 | Supabase Edge Functions | `marketplace-prices.ts`, scrappey, tracked-upsert | trio types / scrappey allowlist | Don’t add mega to Scrappey; widen parse types only if sync/cache needs | Soft/Later | Edge | Cost + type drift |
| 26 | DB migrations / CHECKs | many `202607*` migrations | `in ('wildberries','ozon','yandex_market')` | New migration: widen tables that **must** store mega (tracked, price_scrape_cache, …) | **Req** for cloud track | DB | **Highest** blast radius — list tables carefully |
| 27 | Tests | `*.marketplaces.test.ts`, megamarket parser tests | fixtures | Add live-ish DOM/SERP fixtures; e2e optional | **Req** | tests | Low |
| 28 | QA scripts | `MULTI_STORE_QA.md`, preflight | OTHER MARKETPLACES row | Megamarket smoke checklist | Soft | docs | Low |
| 29 | Error handling | empty-scrape-guard, match-status | not_found / scrape fail | Soft fail; no false alerts | **Req** | client | Med |
| 30 | Cost guards / Scrappey | `cost-guards`, `premium-unlocker-offer`, flags | mega `costTier: tab`; unlocker false | Keep monitoring_enabled=false; never add to scrappey_marketplaces in P0 | **Req** (do not expand) | Edge | **Critical** cost |

---

## Gaps summary (Megamarket P0)

### Already in place (client scaffold)

- Type + registry + detect + adapter + content_scripts + hosts  
- Card parser + SERP branch + compare selection plumbing  
- Flags model (compare vs monitoring)  
- Premium unlocker explicitly **excludes** megamarket  

### Must finish for honest “supported in compare”

1. **Live card + SERP quality** (price/title/id stability).  
2. **Matching** tuned enough for smoke SKUs.  
3. **DB CHECK migration** for any cloud path that stores `marketplace='megamarket'` (at least `tracked_products` / sync if users track from mega cards).  
4. **Ops:** `marketplace_enabled=true` for pilot (monitoring stays false).  
5. **Tests + QA** on real megamarket.ru pages.  
6. Docs: registry “supported” ≠ SEO publish ≠ Telegram monitoring.

### Explicitly not P0

- Scrappey / Telegram cron for megamarket  
- SEO `publishAllowed`  
- agent-orchestrator expansion  
- Implementing Ali/DNS/Citilink/Lamoda/MVideo as “done”

---

## Recommended implementation order (after approval)

1. Live DevTools audit megamarket card + SERP (fix parser/SERP).  
2. DB migration: widen only necessary CHECKs (enumerate tables first).  
3. Fix any sync/Edge type rejects for `megamarket`.  
4. Matching + compare smoke tests.  
5. Enable compare flag in staging; monitoring remains off.  
6. QA checklist; then product may call compare support “READY”.

**Do not** start mass refactor of all 8 MPs.

---

## Stop

Read-only audit complete. No mass implementation started.  
Await approval to implement **Megamarket P0** only, per order above.
