# Megamarket — full extension integration (NO Telegram)

**Date:** 2026-08-26  
**Verdict:** **READY** — Mega is integrated in the extension at CORE parity for card / SERP / compare / track / client refresh / shared cache / research / SEO allowlist.  
**Not CORE-equal:** Reviews (SKIP), Telegram alerts, server `monitoring_enabled` / `update-prices` cron.

---

## OUT OF SCOPE (explicit — do not flip)

| Item | Status | Proof |
|------|--------|-------|
| Telegram detect / `/add` / price alerts for Mega | **OFF** | `skipsTelegramAlertsForMarketplace('megamarket')`; no Mega under `supabase/functions/telegram*` |
| `marketplace_flags.monitoring_enabled` for Mega | **false** | defaults + DB seed; `marketplace-flags.test.ts` |
| `update-prices` / Scrappey **monitoring** allowlist | **trio only** | `cost-guards.ts` `MONITORING_ALLOWED`; Mega never auto-added |
| `resolveMonitoringKey` for Mega | **null** | `monitoring-key.ts` / `.test.ts` |
| `isCronPriceMonitoredMarketplace('megamarket')` | **false** | `registry.ts` — Mega always client-owned refresh |

Do **not** set `monitoring_enabled=true` for Mega without a separate Telegram RFC.

---

## CORE-parity matrix (MEGA-9)

| Area | Status | Notes / evidence |
|------|--------|------------------|
| **Card** | READY | Parser JSON-LD + NEXT_DATA + DOM; OOS; canonical `megamarket.ru`. Tests: `megamarket.test.ts`, `mega-core-parity.regression.test.ts` |
| **SERP** | READY | Detail + `data-product-id` tiles; junk/storage gates. Tests: `megamarket.test.ts`, `mega-serp-match.test.ts` |
| **Compare (client)** | READY | Default-on; selected → offer / needs_choice. `compare-offers.marketplaces.test.ts`, search-settings |
| **Research (Edge)** | READY | VALID = trio + Mega; Mega Scrappey verify **OFF**. `compare-research-targets.test.ts`, MEGA-5 deploy |
| **Track / My Products** | READY | `mm-{goodsId}` (not `yandex-`). `tracked-sync.mega.test.ts`, `price-identity.test.ts` |
| **Client refresh** | READY | Always refresh Mega when CORE cron on. `tracked-client-refresh.test.ts` |
| **Cache** | READY | Shared `price_scrape_cache` R/W. MEGA-4 + `price-scrape-cache.test.ts` |
| **Unlocker** | READY | Premium card-only Scrappey. MEGA-3; `premium-unlocker-offer` / cost-guards |
| **Reviews** | **SKIP** | `capabilities.reviews: false`. `MEGA7_REVIEWS_FEASIBILITY.md` |
| **SEO** | READY* | `publishAllowed` + DB CHECK; *gates still apply (often need webOverview). MEGA-8 |

\* SEO READY = allowlisted + gates enforced; not “flood of Mega pages”.

---

## Phase plan (files)

| Phase | Goal | Status |
|-------|------|--------|
| MEGA-1 Harden card + SERP | done | |
| MEGA-2 Default-on «Где искать» | done | |
| MEGA-3 Premium unlocker card-only | done | |
| MEGA-4 Shared `price_scrape_cache` | done | |
| MEGA-5 Edge `compare-research` | done | |
| MEGA-6 Client tracked / My Products | done | |
| MEGA-7 Reviews | **SKIP** | |
| MEGA-8 SEO `publishAllowed` | done | |
| **MEGA-9** Regression pack + READY gate | **done** — this doc | |

---

## Automated regression

```bash
npm run test:mega
```

Pack entry: `src/lib/mega-core-parity.regression.test.ts` (matrix contract).  
Also runs Mega-focused siblings (parsers, track, SEO, Edge monitoring/cost-guards).

| File | Role |
|------|------|
| `src/lib/mega-core-parity.regression.test.ts` | MEGA-9 matrix gate |
| `src/utils/parsers/megamarket.test.ts` | Card + SERP |
| `src/lib/mega-serp-match.test.ts` | Match junk gates |
| `src/lib/tracked-client-refresh.test.ts` | Refresh vs cron |
| `src/lib/supabase/tracked-sync.mega.test.ts` | Cloud `mm-` |
| `src/lib/seo/seo-marketplaces.test.ts` + `publish-gates.test.ts` | SEO allowlist + gates |
| `supabase/functions/_shared/monitoring-key.test.ts` | No monitoring key |
| `supabase/functions/_shared/cost-guards.test.ts` | Scrappey yes / monitoring no |
| `supabase/functions/_shared/marketplace-flags.test.ts` | monitoring_enabled false |

(`price-scrape-cache.test.ts` is Deno-oriented — covered under Edge check / MEGA-4, not in `test:mega` Vitest pack.)

---

## Manual smoke checklist (operator)

Load zip `priceguard-ai-v{version}.zip` unpacked.

### Extension UX

1. Settings → «Где искать»: Mega **on** for new/empty storage; opt-out persists.  
2. Open `megamarket.ru/catalog/details/…` → popup: title, price, article, canonical host.  
3. OOS card → price 0 / out_of_stock (no fake in-stock).  
4. SERP Mega search page ≠ treated as product card.  
5. Compare from WB/Ozon/YM phone with Mega selected → Mega slot: offer or needs_choice, not furniture/food junk.  
6. CORE trio still defaults/search OK.

### Track / refresh / alerts

7. Track Mega → My Products: Мега badge, `mm-…` identity, `megamarket.ru` URL (not Я.Маркет).  
8. «Обновить цены» → Mega price updates; Chrome notification on drop if alerts on.  
9. With Telegram monitoring **on** for CORE: Mega still client-refreshes; **no** Mega Telegram push.  
10. Premium (if available): force refresh may use card unlocker; periodic refresh does not spam Scrappey for Mega.

### SEO / reviews (optional awareness)

11. Reviews tab: Mega has no review scrape (`reviews: false`).  
12. Do not expect Mega SEO pages without real gate-quality analysis (reviews SKIP → need long webOverview).

### OUT OF SCOPE confirm

13. Server: Mega `monitoring_enabled` still false; no Mega jobs in Telegram bots / `update-prices` allowlist.

---

## Verdict rationale

| Gate | Result |
|------|--------|
| Extension compare + track without Telegram | **PASS** |
| Client refresh ownership when cron on | **PASS** |
| Shared cache + Premium card unlocker | **PASS** |
| Edge research targets include Mega | **PASS** |
| Reviews parity | **N/A (SKIP)** — documented |
| SEO allowlist | **PASS** (gates remain) |
| Telegram / monitoring still OFF | **PASS** |

**READY** means: ship Mega as “integrated in extension” in release notes / QA — **not** “Telegram monitoring parity with WB/Ozon/YM”.
