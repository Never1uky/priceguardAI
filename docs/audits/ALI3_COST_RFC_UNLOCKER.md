# ALI-3 — Cost RFC: AliExpress Premium unlocker (card only)

**Date:** 2026-08-27  
**Status:** **CONDITIONAL SAFE → IMPLEMENT** (card unlocker only)  
**Out of scope:** Telegram, `monitoring_enabled=true`, `update-prices` cron, Ali in `monitoring_marketplaces`, shared `price_scrape_cache` (ALI-4)

---

## Verdict

| Decision | Reason |
|----------|--------|
| **Implement card-only Scrappey unlocker for Ali** | Same Premium gate as Ozon/YM/Mega; no monitoring multiplier; Ali already default-on (ALI-2) but tab-first |
| **Do not** enable monitoring / Telegram | Would multiply Scrappey by cron × tracked users |
| **Do not** write Ali to `price_scrape_cache` yet | CHECK still trio+Mega — defer to **ALI-4**; unlocker uses `skipCache: true` for Ali |

If live Scrappey HTML parse success rate is &lt; ~40% after ship, **kill-switch**: remove Ali from `COST_GUARDS_SCRAPPEY_MARKETPLACES` / defaults without touching monitoring.

---

## When unlocker is called (Ali)

```text
fetchOfferWithFallback(url, 'aliexpress')
  → no HTTP API
  → HiddenBrowser card scrape
  → if empty / no price AND Premium AND Ali selected
       → fetchOfferViaPremiumUnlocker
            → assertPremiumUnlockerAllowed (Premium + selected + allowlist)
            → Edge fetch-product-price (skipCache for Ali)
                 → scraperForMarketplace (scrappey allowlist)
                 → Scrappey HTML → parseAliExpressPriceFromHtml
```

**Not called when:**

- Free plan  
- Ali unchecked in «Где искать»  
- Tab scrape already returned a priced card  
- `skipUnlocker: true` (tracked backup / TG-style paths — unchanged)  
- `scrappey_enabled=false` or Ali not in `scrappey_marketplaces`  
- Monitoring cron / Telegram `/add` (Ali still not a monitoring MP)

---

## Limits / Premium-only

| Layer | Gate |
|-------|------|
| Client | `PREMIUM_UNLOCKER_MARKETPLACES` includes `aliexpress` |
| Client | `isPremium()` + selected in Settings |
| Client | Ali unlocker **`skipCache: true`** until ALI-4 |
| Edge | `fetch-product-price` auth + Premium plan |
| Edge | `VALID` includes `aliexpress` |
| Edge | `scraperForMarketplace` ∩ `scrappey_marketplaces` |
| Cost guards | `monitoring_marketplaces` stays **trio only** |
| Cache | Ali unlocker **no R/W** until ALI-4 |

---

## Cost vs trio + Mega (estimate)

Assumptions: Scrappey ~order **4 ₽ / 1000** successful billable calls; circuit breaker unchanged.

| Scenario | Ali Scrappey delta |
|----------|---------------------|
| Free user, Ali default-on | **0** (unlocker Premium-only) |
| Premium, Ali tab scrape OK | **0** (unlocker not reached) |
| Premium, Ali antibot / empty card | **+1** call per refresh that falls through |
| Compare cascade Top-N cards | Tab-first; unlocker only on final `fetchOfferWithFallback` miss — **not** N× Scrappey |
| Telegram / cron monitoring | **0** (`monitoring_enabled` false; Ali not in monitoring allowlist) |

**Vs Mega:** same card-only pattern. Incremental cost ≈ share of Premium refreshes where Ali tab fails.

**Risk:** Ali antibot / CDN variance may raise **failed** Scrappey attempts. Mitigations: existing circuit; env `COST_GUARDS_SCRAPPEY_MARKETPLACES` without Ali; keep Ali out of monitoring until separate RFC.

---

## Explicit non-goals (this phase)

1. `monitoring_enabled=true` for Ali  
2. Ali in `update-prices` / coalesce / Telegram scrape  
3. Ali in `price_scrape_cache` writers (ALI-4)  
4. Edge `compare-research` Scrappey verify for Ali (ALI-5)  
5. Free-tier Scrappey  
6. `ae-` identity / tracked CHECK (ALI-6)

---

## Implementation checklist (post-RFC)

1. Client `PREMIUM_UNLOCKER_MARKETPLACES` + `skipCache: true` for Ali  
2. Edge `fetch-product-price` VALID + productId from `/item/{id}`  
3. `marketplace-prices`: Ali type + HTML parse + unlocker branch; **no cache R/W**  
4. `cost-guards`: scrappey allowlist may include Ali; **monitoring allowlist stays trio**  
5. Migration: widen `scrappey_marketplaces` to include `aliexpress` (not monitoring)  
6. Tests: allowlist positive Ali; Free/not_selected deny; monitoring still excludes Ali  

---

## Go / no-go

**GO** — card-only Premium unlocker with skipCache and monitoring unchanged.  
**STOP** would apply if we required shared cache + monitoring in the same change (cost too open-ended).

---

## Shipped (2026-08-27)

- Client: `aliexpress` in `PREMIUM_UNLOCKER_MARKETPLACES`; `skipCache: true`
- Edge: `cost-guards` scrappey allowlist + `fetch-product-price` VALID + `parseAliExpressPriceFromHtml`
- Prod: migration `aliexpress_scrappey_allowlist`; deployed `fetch-product-price`
- Cache R/W for Ali: **deferred to ALI-4**
- Telegram / monitoring: **unchanged (trio)**

### Manual smoke (Premium)

1. Ali card selected in «Где искать»; Free → unlocker denied.
2. Premium + empty tab scrape → Edge unlocker may return price (`source: scrappey`).
3. Confirm monitoring cron still ignores Ali URLs.
