# AliExpress — full extension integration (NO Telegram)

**Date:** 2026-08-27  
**Repo:** `C:\Users\sj480\Projects\priceguard-ai`  
**Verdict:** **READY** — Ali is integrated in the extension at CORE parity for card / SERP / compare / track / client refresh / shared cache / research / SEO allowlist.  
**Not CORE-equal:** Reviews (SKIP), Telegram alerts, server `monitoring_enabled` / `update-prices` cron.

Playbook: [`_handoff/mp-integration-pack/PROMPTS/00-how-to-work.md`](../../_handoff/mp-integration-pack/PROMPTS/00-how-to-work.md)  
Mega reference: [`MEGA_FULL_INTEGRATION_NO_TELEGRAM.md`](./MEGA_FULL_INTEGRATION_NO_TELEGRAM.md)  
SEO order: [`../SEO_MP_ROLLOUT.md`](../SEO_MP_ROLLOUT.md)

---

## OUT OF SCOPE (explicit — do not flip)

| Item | Status | Proof |
|------|--------|-------|
| Telegram detect / `/add` / price alerts for Ali | **OFF** | `skipsTelegramAlertsForMarketplace('aliexpress')`; no Ali under `supabase/functions/telegram*` |
| `marketplace_flags.monitoring_enabled` for Ali | **false** | Seed `('aliexpress', false, false, 'test')` — do not flip |
| `update-prices` / Scrappey **monitoring** allowlist | **trio only** | `cost-guards.ts` `MONITORING_ALLOWED`; Ali never auto-added |
| `resolveMonitoringKey` for Ali | **null** | `monitoring-key.ts` / `.test.ts` |
| `isCronPriceMonitoredMarketplace('aliexpress')` | **false** | `registry.ts` — Ali always client-owned refresh |

Do **not** set `monitoring_enabled=true` for Ali without a separate Telegram RFC.

---

## CORE-parity matrix (ALI-9)

| Area | Status | Notes / evidence |
|------|--------|------------------|
| **Card** | READY | Dedicated `aliexpress.ts` (JSON-LD / embedded / DOM); OOS; canonical `aliexpress.ru/item/{id}.html`. Tests: `aliexpress.test.ts`, `ali-core-parity.regression.test.ts` |
| **SERP** | READY | Wholesale `/item/` tiles; junk/storage gates (Mega parity). Tests: `aliexpress.test.ts`, Edge `marketplace-search-core.test.ts` |
| **Compare (client)** | READY | Default-on (ALI-2); selected → offer / needs_choice. `search-settings.test.ts`, compare-offers |
| **Research (Edge)** | READY | VALID = trio + Mega + Ali; Ali Scrappey verify **OFF**. `compare-research-targets.test.ts`, ALI-5 deploy |
| **Track / My Products** | READY | `ae-{itemId}` (not `yandex-`). `tracked-sync.ali.test.ts`, `price-identity.test.ts` |
| **Client refresh** | READY | Always refresh Ali when CORE cron on. `tracked-client-refresh.test.ts` |
| **Cache** | READY | Shared `price_scrape_cache` R/W. ALI-4 |
| **Unlocker** | READY | Premium card-only Scrappey. ALI-3; `premium-unlocker-offer` / cost-guards |
| **Reviews** | **READY (tab DOM)** | Active-tab DOM (`RedReviews*`); no Scrappey. `ALI7_REVIEWS_FEASIBILITY.md` |
| **SEO** | READY* | `publishAllowed` + DB CHECK; *gates still apply (often need webOverview). ALI-8 |

\* SEO READY = allowlisted + gates enforced; not “flood of Ali pages”.

---

## Phase plan (files)

| Phase | Goal | Status |
|-------|------|--------|
| ALI-1 Harden card + SERP | done | `ALI1_CARD_SERP.md` |
| ALI-2 Default-on «Где искать» | done | `ALI2_DEFAULT_ON.md` |
| ALI-3 Premium unlocker card-only | done | `ALI3_COST_RFC_UNLOCKER.md` |
| ALI-4 Shared `price_scrape_cache` | done | `ALI4_PRICE_SCRAPE_CACHE_DEPLOY.md` |
| ALI-5 Edge `compare-research` | done | `ALI5_COMPARE_RESEARCH_DEPLOY.md` |
| ALI-6 Client tracked / My Products | done | `ALI6_CLIENT_TRACKED.md` |
| ALI-7 Reviews | **READY (tab DOM)** | `ALI7_REVIEWS_FEASIBILITY.md` |
| ALI-8 SEO `publishAllowed` | done | `ALI8_SEO_PUBLISH.md` |
| **ALI-9** Regression pack + READY gate | **done** — this doc | |

---

## Automated regression

```bash
npm run test:ali
```

Pack entry: `src/lib/ali-core-parity.regression.test.ts` (matrix contract).  
Also runs Ali-focused siblings (parsers, track, SEO, Edge cost-guards / research / monitoring-key).

| File | Role |
|------|------|
| `src/lib/ali-core-parity.regression.test.ts` | ALI-9 matrix gate |
| `src/utils/parsers/aliexpress.test.ts` | Card + SERP + policy |
| `src/lib/tracked-client-refresh.test.ts` | Refresh vs cron |
| `src/lib/supabase/tracked-sync.ali.test.ts` | Cloud `ae-` |
| `src/lib/price-identity.test.ts` | `ae-` identity |
| `src/lib/compare-research-targets.test.ts` | Research targets |
| `src/lib/seo/seo-marketplaces.test.ts` + `publish-gates.test.ts` | SEO allowlist + gates |
| `src/lib/premium-unlocker-offer.test.ts` | Card unlocker |
| `src/lib/marketplaces/search-settings.test.ts` | Default-on |
| `supabase/functions/_shared/monitoring-key.test.ts` | No monitoring key |
| `supabase/functions/_shared/cost-guards.test.ts` | Scrappey yes / monitoring no |
| `supabase/functions/_shared/marketplace-search-core.test.ts` | Edge SERP + targets |

---

## Manual smoke checklist (operator)

Load zip `priceguard-ai-v{version}.zip` unpacked.

### Extension UX

1. Settings → «Где искать»: Ali **on** for new/empty storage; opt-out persists.  
2. Open `aliexpress.ru/item/{id}.html` → popup: title, price, article, canonical URL.  
3. OOS card → price 0 / out_of_stock (no fake in-stock).  
4. Wholesale SERP ≠ treated as product card.  
5. Compare from WB/Ozon/YM with Ali selected → Ali slot: offer or needs_choice, not junk.  
6. CORE trio + Mega still defaults/search OK.

### Track / refresh / alerts

7. Track Ali → My Products: AliExpress badge, `ae-…` identity, `aliexpress.ru` URL (not Я.Маркет).  
8. «Обновить цены» → Ali price updates; Chrome notification on drop if alerts on.  
9. With Telegram monitoring **on** for CORE: Ali still client-refreshes; **no** Ali Telegram push.  
10. Premium (if available): force refresh may use card unlocker; research does not Scrappey-verify Ali top-1.

### SEO / reviews (optional awareness)

11. Reviews tab: Ali card open → DOM scrape (`reviews: true`); Mega still unsupported.  
12. Do not expect Ali SEO pages without real gate-quality analysis (reviews help when collected; thin webOverview still fails gates).

### OUT OF SCOPE confirm

13. Server: Ali `monitoring_enabled` still false; no Ali jobs in Telegram bots / `update-prices` allowlist.

---

## Verdict rationale

| Gate | Result |
|------|--------|
| Extension compare + track without Telegram | **PASS** |
| Client refresh ownership when cron on | **PASS** |
| Shared cache + Premium card unlocker | **PASS** |
| Edge research targets include Ali | **PASS** |
| Reviews parity | **N/A (SKIP)** — documented |
| SEO allowlist | **PASS** (gates remain) |
| Telegram / monitoring still OFF | **PASS** |

**READY** means: ship Ali as “integrated in extension” in release notes / QA — **not** “Telegram monitoring parity with WB/Ozon/YM”.

---

## Queue after AliExpress

| Order | MP | Notes |
|-------|-----|--------|
| 1 | **aliexpress** | This doc — **READY** |
| 2 | **mvideo** | Tab/generic; electronics SERP |
| 3 | **dns** | Tab/generic; SKU-heavy titles |
| 4 | **citilink** | Tab/generic |
| 5 | **lamoda** | Fashion gate / category false-match risk |

Same OUT OF SCOPE (Telegram / monitoring / cron) unless a separate RFC says otherwise. Keep `enabledByDefault: false` until each next MP is READY and product OK.
