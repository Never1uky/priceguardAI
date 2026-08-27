# MEGA-3 — Cost RFC: Megamarket Premium unlocker (card only)

**Date:** 2026-08-26  
**Status:** **CONDITIONAL SAFE → IMPLEMENT** (card unlocker only)  
**Out of scope:** Telegram, `monitoring_enabled=true`, `update-prices` cron, Mega in `monitoring_marketplaces`

---

## Verdict

| Decision | Reason |
|----------|--------|
| **Implement card-only Scrappey unlocker for Mega** | Same Premium gate as Ozon/YM; no monitoring multiplier; Mega already default-on for compare but tab-first |
| **Do not** enable monitoring / Telegram | Would multiply Scrappey by cron × tracked users |
| **Do not** write Mega to `price_scrape_cache` yet | CHECK still trio — defer to **MEGA-4**; unlocker uses `skipCache: true` for Mega |

If live Scrappey HTML parse success rate is &lt; ~40% after ship, **kill-switch**: remove Mega from `COST_GUARDS_SCRAPPEY_MARKETPLACES` / defaults without touching monitoring.

---

## When unlocker is called (Mega)

```text
fetchOfferWithFallback(url, 'megamarket')
  → no HTTP API
  → HiddenBrowser card scrape
  → if empty / no price AND Premium AND Mega selected
       → fetchOfferViaPremiumUnlocker
            → assertPremiumUnlockerAllowed (Premium + selected + allowlist)
            → Edge fetch-product-price (skipCache for Mega)
                 → scraperForMarketplace (scrappey allowlist)
                 → Scrappey HTML → parseMegamarketPriceFromHtml
```

**Not called when:**

- Free plan  
- Mega unchecked in «Где искать»  
- Tab scrape already returned a priced card  
- `skipUnlocker: true` (tracked backup / TG-style paths — unchanged)  
- `scrappey_enabled=false` or Mega not in `scrappey_marketplaces`  
- Monitoring cron / Telegram `/add` (Mega still not a monitoring MP)

---

## Limits / Premium-only

| Layer | Gate |
|-------|------|
| Client | `PREMIUM_UNLOCKER_MARKETPLACES` includes `megamarket` |
| Client | `isPremium()` + selected in Settings |
| Edge | `fetch-product-price` auth + Premium plan |
| Edge | `VALID` includes `megamarket` |
| Edge | `scraperForMarketplace` ∩ `scrappey_marketplaces` |
| Cost guards | `monitoring_marketplaces` stays **trio only** |
| Cache | Mega unlocker **skipCache** until MEGA-4 |

---

## Cost vs trio (estimate)

Assumptions (same ballpark as Step 4): Scrappey ~order **4 ₽ / 1000** successful billable calls; circuit breaker unchanged.

| Scenario | Mega Scrappey delta |
|----------|---------------------|
| Free user, Mega default-on | **0** (unlocker Premium-only) |
| Premium, Mega tab scrape OK | **0** (unlocker not reached) |
| Premium, Mega antibot / empty card | **+1** call per refresh that falls through |
| Compare cascade Top-N cards | Tab-first; unlocker only on final `fetchOfferWithFallback` miss — **not** N× Scrappey |
| Telegram / cron monitoring | **0** (`monitoring_enabled` false; Mega not in monitoring allowlist) |

**Vs trio:** Mega adds a **fourth** Premium unlocker surface. Incremental cost ≈ share of Premium refreshes where Mega tab fails. That is **much lower** than enabling monitoring (cron × all tracked Mega URLs).

**Risk:** Mega antibot may raise **failed** Scrappey attempts (still billed by provider depending on plan). Mitigations: existing circuit; env `COST_GUARDS_SCRAPPEY_MARKETPLACES` without Mega; keep Mega out of monitoring forever until separate RFC.

---

## Explicit non-goals (this phase)

1. `monitoring_enabled=true` for Mega  
2. Mega in `update-prices` / coalesce / Telegram scrape  
3. Mega in `price_scrape_cache` writers (MEGA-4)  
4. Edge `compare-research` Scrappey verify for Mega (MEGA-5)  
5. Free-tier Scrappey  

---

## Implementation checklist (post-RFC)

1. Client `PREMIUM_UNLOCKER_MARKETPLACES` + `skipCache: true` for Mega  
2. Edge `fetch-product-price` VALID + productId from `/catalog/details/`  
3. `marketplace-prices`: Mega type + HTML parse + unlocker branch; **no cache R/W**  
4. `cost-guards`: scrappey allowlist may include Mega; **monitoring allowlist stays trio**  
5. Tests: allowlist positive Mega; Free/not_selected deny; monitoring still excludes Mega  
6. `package:zip`  

---

## Go / no-go

**GO** — card-only Premium unlocker with skipCache and monitoring unchanged.  
**STOP** would apply if we required shared cache + monitoring in the same change (cost too open-ended).
