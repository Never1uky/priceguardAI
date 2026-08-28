# М.Видео (`mvideo`) — full extension integration (NO Telegram)

**Date:** 2026-08-27  
**Repo:** `C:\Users\sj480\Projects\priceguard-ai`  
**Verdict:** **READY** — M.Video is integrated in the extension at CORE parity for card / SERP / compare / track / client refresh / shared cache / research / SEO allowlist. Reviews SKIP (MVIDEO-7). Telegram/monitoring OFF.

Playbook: [`_handoff/mp-integration-pack/PROMPTS/00-how-to-work.md`](../../_handoff/mp-integration-pack/PROMPTS/00-how-to-work.md)  
Mega reference: [`MEGA_FULL_INTEGRATION_NO_TELEGRAM.md`](./MEGA_FULL_INTEGRATION_NO_TELEGRAM.md)  
Ali reference: [`ALIEXPRESS_FULL_INTEGRATION_NO_TELEGRAM.md`](./ALIEXPRESS_FULL_INTEGRATION_NO_TELEGRAM.md)  
SEO order: [`../SEO_MP_ROLLOUT.md`](../SEO_MP_ROLLOUT.md)

**Hosts:** `mvideo.ru` + `eldorado.ru` (одна сеть → единый id `mvideo`; legacy id `eldorado` → `migrateLegacyMarketplaceId`).

---

## OUT OF SCOPE (explicit — do not flip)

| Item | Status | Proof / target |
|------|--------|----------------|
| Telegram detect / `/add` / price alerts for mvideo | **OFF** | Not in Edge product-url detect; no telegram path; keep OFF |
| `marketplace_flags.monitoring_enabled` for mvideo | **false** | Seed `('mvideo', false, false, 'test')` — do not flip |
| `update-prices` / Scrappey **monitoring** allowlist | **trio only** | `cost-guards.ts` `MONITORING_ALLOWED`; mvideo never auto-added |
| `resolveMonitoringKey` for mvideo | **null** | `monitoring-key.ts` — core trio only |
| `isCronPriceMonitoredMarketplace('mvideo')` | **false** | `registry.ts` — client-owned refresh |
| Fake `reviewCount` / weaken `SEO_MIN_*` | **never** | Same as ALI-8 / MEGA-8 |
| `publishAllowed` for dns / citilink / lamoda | **not this branch** | — |

Do **not** set `monitoring_enabled=true` for mvideo without a separate Telegram RFC.

---

## Current state (2026-08-27)

| Area | Status now | Evidence | Gap vs Mega/Ali |
|------|------------|----------|-----------------|
| **Card** | **READY (MVIDEO-1)** | Dedicated `mvideo.ts`; OOS; dual-host. Tests: `mvideo.test.ts` | — |
| **SERP** | **READY (MVIDEO-1)** | `scrapeMvideoCandidates`; junk/price gates via `isAliMegaMarketplace` | — |
| **Compare (client)** | **READY (MVIDEO-2)** | Default-on; removed from `TEST_MARKETPLACE_IDS` | — |
| **Research (Edge)** | **READY (MVIDEO-5)** | VALID ∩ selected; SERP HTML or []; verify OFF | — |
| **Track / identity** | **READY (MVIDEO-6)** | `mv-{id}`; Edge product-id; tracked CHECK | — |
| **Client refresh** | **READY (MVIDEO-6)** | Always refresh mvideo when CORE cron on | — |
| **Cache** | **READY (MVIDEO-4)** | CHECK + Edge R/W + client `skipCache: false` | — |
| **Unlocker** | **READY (MVIDEO-3)** | Premium card-only Scrappey; cache via MVIDEO-4 | — |
| **Reviews** | **SKIP (MVIDEO-7)** | `reviews: false`; antibot in automation; no scraper | Revisit on live ≥3 DOM texts |
| **SEO** | **READY (MVIDEO-8)** | `publishAllowed` + `offersAllowed`; DB CHECK; gates unchanged | Sync priceguard-seo mirror if separate repo |
| **Telegram / monitoring** | OFF | flags seed `test`; monitoring-key null | **Keep OFF** |

Already present (do not re-invent): registry entry, tab adapter (dual host), electronics search gate (`ELECTRONICS_TAB_MPS`), SEO slug/titleStrip, telemetry id + eldorado remap, opt-in compare when selected, manifest hosts for mvideo/eldorado.

---

## CORE-parity matrix (MVIDEO-9)

| Area | Target | Notes |
|------|--------|-------|
| **Card** | READY | Stable title/price/article; OOS ≠ fake in-stock; canonical policy for both hosts |
| **SERP** | READY | Product-list candidates; SERP ≠ card; junk/false-match under control |
| **Compare (client)** | READY | Default-on (MVIDEO-2); selected → offer / needs_choice |
| **Research (Edge)** | READY | VALID includes mvideo; Scrappey verify **OFF** (Ali/Mega parity) |
| **Track / My Products** | READY | Stable `mv-{id}` (or chosen prefix); not `yandex-` bleed |
| **Client refresh** | READY | Always refresh mvideo when CORE cron on |
| **Cache** | READY | Shared `price_scrape_cache` R/W (or explicit N/A in phase note) |
| **Unlocker** | READY | Premium card-only Scrappey after MVIDEO-3 RFC |
| **Reviews** | **SKIP** | Documented in `MVIDEO7_REVIEWS_FEASIBILITY.md` (antibot / no scraper) |
| **SEO** | READY* | `publishAllowed` only after product OK; gates unchanged; webOverview enrich path global |

\* SEO READY = allowlisted + gates enforced; not “flood of mvideo pages”.

---

## Phase plan (MVIDEO-1…9)

| Phase | Goal | Primary files | Scrappey? | Status |
|-------|------|---------------|-----------|--------|
| **MVIDEO-1** | Harden card + SERP; OOS; canonical URL (mvideo.ru / eldorado.ru); SERP ≠ card; unit fixtures | `mvideo.ts`, `product-url.ts`, `adapter-config.ts`, `search-results.ts`, `mvideo.test.ts` | No | **done** — `MVIDEO1_CARD_SERP.md` |
| **MVIDEO-2** | Default-on «Где искать»; remove from `TEST_MARKETPLACE_IDS` when ready | `registry.ts`, `search-settings.ts`, `adapter-config.ts`, Settings copy, flags migration | No | **done** — `MVIDEO2_DEFAULT_ON.md` |
| **MVIDEO-3** | Cost RFC + Premium card-only unlocker | `premium-unlocker-offer.ts`, `cost-guards.ts`, `marketplace-prices.ts`, `fetch-product-price`, scrappey migration | Card-only yes; monitoring never | **done** — `MVIDEO3_COST_RFC_UNLOCKER.md` |
| **MVIDEO-4** | Shared `price_scrape_cache` R/W + migration CHECK widen | `price-scrape-cache.ts`, price-cache / fetch-product-price, migration | Via unlocker/refresh | **done** — `MVIDEO4_PRICE_SCRAPE_CACHE_DEPLOY.md` |
| **MVIDEO-5** | Edge `compare-research` VALID ∩ selected; SERP extract; verify OFF | `marketplace-search-core.ts`, compare-research-targets tests, deploy | Verify OFF | **done** — `MVIDEO5_COMPARE_RESEARCH_DEPLOY.md` |
| **MVIDEO-6** | Storage prefix `mv-`; Edge product-id / `parseProductKey`; tracked-sync if needed; client refresh tests | `price-identity.ts`, Edge product-id/url, tracked-* | No TG | **done** — `MVIDEO6_CLIENT_TRACKED.md` |
| **MVIDEO-7** | Reviews feasibility → READY tab DOM or documented SKIP | registry, reviews path, `MVIDEO7_REVIEWS_FEASIBILITY.md` | No Scrappey reviews | **SKIP** — `MVIDEO7_REVIEWS_FEASIBILITY.md` |
| **MVIDEO-8** | SEO `publishAllowed` + `offersAllowed`; mirrors + DB CHECK; gates unchanged | `seo-marketplaces.ts` ×2, migration, deploy seo-publish | No | **done** — `MVIDEO8_SEO_PUBLISH.md` |
| **MVIDEO-9** | `npm run test:mvideo` + `mvideo-core-parity.regression.test.ts`; update this doc READY/NOT READY | `package.json`, regression pack | — | **done** — `MVIDEO9_CORE_PARITY_REGRESSION.md` |
| **MVIDEO-10** | Telemetry Reliability: `search_metrics` + 24h view + alerts for `mvideo` | `flush.ts`, migrations, `search-success-alerts.ts` | — | **pending** — `MVIDEO10_TELEMETRY.md` |

**Minimal path (extension without Telegram):** 1 → 2 → 4 → 6 → 9.  
**Closer to CORE:** +3 +5.  
**SEO (8):** only after Adapter READY + product OK.

### Dual-host / canonical (decided in MVIDEO-1)

- Identity: Eldorado URLs stay marketplace id `mvideo` (existing migrate).  
- Canonical: **keep origin host** (mvideo.ru vs eldorado.ru); strip query/hash; prefer `www.` — documented in `MVIDEO1_CARD_SERP.md`.  
- Do not invent WB-style templates; use `toCanonicalProductUrl`.

### Storage prefix (MVIDEO-6)

- **`mv-`** (mirrors `mm-` / `ae-`).  
- Legacy `mvideo-{article}` / `mvideo:` card ids still strip via `bareProductArticle` → `mv-` on track/storage.

---

## Definition of READY / NOT READY

**READY** = card price stable, SERP usable, compare selected → offer/needs_choice with acceptable false-match, track id stable, client refresh owns price when cron on for trio, research/cache/unlocker as designed, reviews `true` **or** SKIP doc, SEO allowlist only if intentional; Telegram/monitoring still OFF.

**NOT READY** = flaky price, wrong identity (Я.Маркет / `yandex-` bleed), junk false-match, or SEO publish without adapter readiness.

**READY ≠ Telegram monitoring parity.**

---

## Draft manual smoke (operator)

Load zip `priceguard-ai-v{version}.zip` unpacked (after phases land).

### Extension UX

1. Settings → «Где искать»: mvideo **on** for new/empty storage (after MVIDEO-2); opt-out persists.  
2. Open `mvideo.ru/products/…` **and** `eldorado.ru/cat/detail/…` → popup: title, price, article, canonical.  
3. OOS card → price 0 / out_of_stock (no fake in-stock).  
4. SERP (`product-list-page` / Eldorado search) ≠ treated as product card.  
5. Compare from WB/Ozon/YM **electronics** with mvideo selected → offer or needs_choice (fashion skipped by electronics gate).  
6. CORE trio + Mega + Ali still defaults/search OK.

### Track / refresh / alerts

7. Track mvideo → My Products: М.Видео badge, `mv-…` identity, correct URL (not Я.Маркет).  
8. «Обновить цены» → mvideo price updates; Chrome notification on drop if alerts on.  
9. With Telegram monitoring **on** for CORE: mvideo still client-refreshes; **no** mvideo Telegram push.  
10. Premium (if MVIDEO-3): force refresh may use card unlocker; research does **not** Scrappey-verify mvideo top-1.

### SEO / reviews

11. Reviews: **SKIP** (MVIDEO-7) — no ReviewsTab for mvideo URL paste until revisit.  
12. Do not expect mvideo SEO pages without gate-quality analysis; thin `webOverview` still fails gates (compose/enrich path is global — no fake reviews).

### OUT OF SCOPE confirm

13. Server: mvideo `monitoring_enabled` still false; MONITORING_ALLOWED unchanged; no mvideo jobs in Telegram bots / `update-prices`.

---

## Automated regression (MVIDEO-9)

```bash
npm run test:mvideo
```

| File | Role |
|------|------|
| `src/lib/mvideo-core-parity.regression.test.ts` | MVIDEO-9 matrix gate |
| `src/utils/parsers/mvideo.test.ts` | Card + SERP fixtures |
| `src/lib/tracked-client-refresh.test.ts` | Client refresh when cron on |
| `src/lib/supabase/tracked-sync.mvideo.test.ts` | Edge tracked-sync VALID |
| `src/lib/compare-research-targets.test.ts` | Research target selection |
| `src/lib/seo/seo-marketplaces.test.ts` + `publish-gates.test.ts` | SEO allowlist + gates |
| `src/lib/premium-unlocker-offer.test.ts` | Card unlocker allowlist |
| `src/lib/product-page-fetch.cache.test.ts` | Shared cache path (MVIDEO-4) |
| `src/lib/marketplaces/search-settings.test.ts` + `test-mp-urls.test.ts` | Default-on + URL fixtures |
| `src/lib/price-identity.test.ts` | `mv-` prefix |
| `supabase/functions/_shared/monitoring-key.test.ts` | monitoring-key null for mvideo |
| `supabase/functions/_shared/cost-guards.test.ts` | MONITORING_ALLOWED trio |
| `supabase/functions/_shared/marketplace-search-core.test.ts` | SERP + compare-research VALID |

(`price-scrape-cache.test.ts` is Deno-oriented — covered under Edge check / MVIDEO-4, not in `test:mvideo` Vitest pack.)

---

## Risks

- Dual-host (mvideo vs eldorado) identity / canonical drift  
- Antibot / empty SERP / SPA price DOM flaky on generic parse  
- False-match on accessories / wrong category (electronics gate helps fashion only)  
- Scrappey cost if unlocker enabled without RFC  
- Storage prefix migration if any cloud `mvideo-` rows exist before `mv-`

---

## Queue after mvideo (notes only — do not implement here)

| Order | MP | Notes |
|-------|-----|--------|
| 1 | **mvideo** | This doc — plan; implement by MVIDEO-1…9 |
| 2 | **dns** | Tab/generic; SKU-heavy titles; same Edge gap pattern |
| 3 | **citilink** | Tab/generic; same phase template |
| 4 | **lamoda** | Fashion gate / category false-match — harder compare; keep SEO off longer |

Same OUT OF SCOPE (Telegram / monitoring / cron) unless a separate RFC says otherwise. Keep `enabledByDefault: false` until each MP is READY and product OK.

---

## Gaps vs Ali/Mega (summary)

1. ~~No dedicated card/SERP parser~~ → **done (MVIDEO-1)**.  
2. ~~`enabledByDefault: false`~~ → **done (MVIDEO-2)**; remaining TEST: dns, citilink, lamoda.  
3. Not in Edge `Marketplace` / `parseProductKey` / product-url (client unlocker uses fetch-product-price VALID; full product-id Edge later).  
4. ~~No Premium unlocker / `SCRAPPEY_ALLOWED`~~ → **done (MVIDEO-3)** card-only; monitoring still OFF.  
5. ~~No `price_scrape_cache` / DB CHECK widen~~ → **done (MVIDEO-4)**.
6. ~~In `COMPARE_RESEARCH_VALID`~~ → **done (MVIDEO-5)**.
7. ~~Storage prefix **`mv-`**~~ → **done (MVIDEO-6)**; Edge strip/`parseProductKey` include mvideo.
8. Reviews **SKIP** (MVIDEO-7); `capabilities.reviews` stays false.  
9. SEO **`publishAllowed: true`** (MVIDEO-8); slug/strip wired; gates still apply.  
10. ~~No `test:mvideo` / core-parity regression pack~~ → **done (MVIDEO-9)**.  
11. Reliability `search_metrics` / `/ops` 24h row for mvideo → **MVIDEO-10** (`MVIDEO10_TELEMETRY.md`).

---

## Verdict rationale

M.Video meets READY: dedicated card/SERP parser with dual-host canonical policy; default-on compare; Premium card-only unlocker + shared cache; Edge compare-research; `mv-` track identity with client refresh when CORE cron on; reviews documented SKIP; SEO allowlisted with gates unchanged. Telegram detect/monitoring/cron remain OFF by design (same as Mega/Ali).

---

## Next action

**MVIDEO-1…9 done.** Deploy gap audit: [`DEPLOY_CHECKLIST_MP_STACK.md`](./DEPLOY_CHECKLIST_MP_STACK.md) + prod migrations [`PROD_MIGRATION_STATUS_2026-08-28.md`](./PROD_MIGRATION_STATUS_2026-08-28.md).  
**MVIDEO-10** (telemetry Reliability row on `/ops`): [`MVIDEO10_TELEMETRY.md`](./MVIDEO10_TELEMETRY.md).  
Redeploy **`priceguard-landing`** for `/ops` UI (Economics + multi-MP Reliability). Do not flip monitoring/Telegram without a separate RFC.
