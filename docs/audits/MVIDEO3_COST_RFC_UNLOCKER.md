# MVIDEO-3 — Cost RFC: М.Видео Premium unlocker (card only)

**Date:** 2026-08-27  
**Status:** **CONDITIONAL SAFE → IMPLEMENT** (card unlocker only)  
**Out of scope:** Telegram, `monitoring_enabled=true`, `update-prices` cron, mvideo in `monitoring_marketplaces`, shared `price_scrape_cache` (MVIDEO-4)

---

## Verdict

| Decision | Reason |
|----------|--------|
| **Implement card-only Scrappey unlocker for mvideo** | Same Premium gate as Ozon/YM/Mega/Ali; no monitoring multiplier; mvideo already default-on (MVIDEO-2) but tab-first |
| **Do not** enable monitoring / Telegram | Would multiply Scrappey by cron × tracked users |
| **Do not** write mvideo to `price_scrape_cache` yet | CHECK still trio+Mega+Ali — defer to **MVIDEO-4**; unlocker uses `skipCache: true` for mvideo |

If live Scrappey HTML parse success rate is &lt; ~40% after ship, **kill-switch**: remove mvideo from `COST_GUARDS_SCRAPPEY_MARKETPLACES` / defaults without touching monitoring.

---

## When unlocker is called (mvideo)

```text
fetchOfferWithFallback(url, 'mvideo')
  → no HTTP API
  → HiddenBrowser card scrape
  → if empty / no price AND Premium AND mvideo selected
       → fetchOfferViaPremiumUnlocker
            → assertPremiumUnlockerAllowed (Premium + selected + allowlist)
            → Edge fetch-product-price (skipCache for mvideo)
                 → scraperForMarketplace (scrappey allowlist)
                 → Scrappey HTML → parseMvideoPriceFromHtml
```

**Not called when:**

- Free plan  
- mvideo unchecked in «Где искать»  
- Tab scrape already returned a priced card  
- `skipUnlocker: true` (tracked backup / TG-style paths — unchanged)  
- `scrappey_enabled=false` or mvideo not in `scrappey_marketplaces`  
- Monitoring cron / Telegram `/add` (mvideo still not a monitoring MP)

---

## Limits / Premium-only

| Layer | Gate |
|-------|------|
| Client | `PREMIUM_UNLOCKER_MARKETPLACES` includes `mvideo` |
| Client | `isPremium()` + selected in Settings |
| Client | mvideo unlocker **`skipCache: false`** after MVIDEO-4 |
| Edge | `fetch-product-price` auth + Premium plan |
| Edge | `VALID` includes `mvideo` |
| Edge | `scraperForMarketplace` ∩ `scrappey_marketplaces` |
| Cost guards | `monitoring_marketplaces` stays **trio only** |
| Cache | mvideo unlocker **R/W** after MVIDEO-4 |

---

## Cost vs trio + Mega + Ali (estimate)

Assumptions: Scrappey ~order **4 ₽ / 1000** successful billable calls; circuit breaker unchanged.

| Scenario | mvideo Scrappey delta |
|----------|---------------------|
| Free user, mvideo default-on | **0** (unlocker Premium-only) |
| Premium, mvideo tab scrape OK | **0** (unlocker not reached) |
| Premium, mvideo antibot / empty card | **+1** call per refresh that falls through |
| Compare cascade Top-N cards | Tab-first; unlocker only on final miss — **not** N× Scrappey |
| Telegram / cron monitoring | **0** (`monitoring_enabled` false; mvideo not in monitoring allowlist) |

**Vs Mega/Ali:** same card-only pattern. Incremental cost ≈ share of Premium refreshes where mvideo tab fails.

**Risk:** dual-host (eldorado.ru) / antibot may raise **failed** Scrappey attempts. Mitigations: existing circuit; env `COST_GUARDS_SCRAPPEY_MARKETPLACES` without mvideo; keep mvideo out of monitoring until separate RFC.

---

## Explicit non-goals (this phase)

1. `monitoring_enabled=true` for mvideo  
2. mvideo in `update-prices` / coalesce / Telegram scrape  
3. mvideo in `price_scrape_cache` writers (MVIDEO-4)  
4. Edge `compare-research` Scrappey verify for mvideo (MVIDEO-5)  
5. Free-tier Scrappey  
6. `mv-` identity / tracked CHECK (MVIDEO-6)

---

## Implementation checklist (post-RFC)

1. Client `PREMIUM_UNLOCKER_MARKETPLACES` + `skipCache: true` for mvideo  
2. Edge `fetch-product-price` VALID + productId from mvideo/eldorado URL  
3. `marketplace-prices`: mvideo type + HTML parse + unlocker branch; **no cache R/W**  
4. `cost-guards`: scrappey allowlist may include mvideo; **monitoring allowlist stays trio**  
5. Migration: widen `scrappey_marketplaces` to include `mvideo` (not monitoring)  
6. Tests: allowlist positive mvideo; Free/not_selected deny; monitoring still excludes mvideo  

---

## Go / no-go

**GO** — card-only Premium unlocker with skipCache and monitoring unchanged.  
**STOP** would apply if we required shared cache + monitoring in the same change (cost too open-ended).

---

## Shipped (2026-08-27)

- Client: `mvideo` in `PREMIUM_UNLOCKER_MARKETPLACES`; `skipCache: true`
- Edge: `cost-guards` scrappey allowlist + `fetch-product-price` VALID + `parseMvideoPriceFromHtml`
- Prod: migration `mvideo_scrappey_allowlist`; deployed `fetch-product-price`
- Cache R/W for mvideo: **deferred to MVIDEO-4**
- Telegram / monitoring: **unchanged (trio)**

### Manual smoke (Premium)

1. mvideo card selected in «Где искать»; Free → unlocker denied.
2. Premium + empty tab scrape → Edge unlocker may return price (`source: scrappey`).
3. Confirm monitoring cron still ignores mvideo URLs.
