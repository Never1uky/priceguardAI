# Phase 16 — Manual test plan

Concrete post-audit smoke/regression for monitoring, flags, Free/Premium, and release.  
**Do not change production secrets.** Prefer staging / two throwaway Telegram chats + one known product URL.

Related: Phases 4–15 (`docs/audits/PHASE*.md`), `docs/QA_DEBUG_CHECKLIST.md`.

---

## Prerequisites

| Item | Detail |
|------|--------|
| Build | Load **zip / `dist/`** from Phase 15 (`npm run package:zip`), not raw source unless intentional |
| Accounts | A: existing Chrome profile with tracks; B: clean profile; Telegram users T1, T2 (Premium or trial for Scrappey paths) |
| Product | One stable Ozon **or** WB card URL with bare `product_id` (same URL for T1+T2) |
| Observe scrapes | See **Observability** below — do not guess from UI alone |

### Observability (how to count scrapes)

Use **at least one** of:

1. **SQL** (Supabase SQL editor) — before/after timestamps:
   ```sql
   -- Active subscribers for a SKU
   select user_id, marketplace, product_id, deleted, last_checked, last_price
   from tracked_products
   where marketplace = 'ozon' and product_id = '<BARE_ID>'
   order by updated_at desc;

   -- Shared cache row (one per mp:id)
   select marketplace, product_id, price, fetched_at, source
   from price_scrape_cache
   where marketplace = 'ozon' and product_id = '<BARE_ID>';
   ```
2. **Ops telemetry** (Phase 11): `scrape_*` / `telegram_monitor_*` events around cron — filter by marketplace + time window. Expect **one** live scrape per coalesced group when stale.
3. **Admin economics** (Phase 12, developer email): inventory / scrapes / subscribers for the period — sanity check after TESTS 7–10.
4. **Edge logs** (`update-prices`): one fetch per group, not ×users.

**Canonical key:** `marketplace` + bare `product_id` (e.g. `ozon:12345`). Different query strings / same id = **one** monitoring target.

### Force a scrape (when needed)

- Soft-stale: set `last_checked` / cache `fetched_at` older than freshness (Free ~6h, Premium ~3h) **or** wait for cron.
- Prefer **one** manual `update-prices` invoke (service role / cron) over hammering Telegram `/add`.

### Pass criteria legend

- **PASS** — expected column matches
- **FAIL** — stop and file bug with SQL snapshot + time window

---

## TEST 1 — Existing user updates extension

| | |
|--|--|
| **Setup** | Profile A already has tracked products + settings (search MPs, Telegram linked if any) |
| **Steps** | 1. Note track count + one product URL. 2. Remove old extension. 3. Load new `dist`/zip. 4. Open popup → «Мои товары» / Settings. |
| **Expect** | Tracks still present (local + cloud sync if logged in). No wipe. Version in SW / about matches zip. No repeated permission storm beyond MV3 hosts. |
| **Verify** | Same product list; login session if previously signed in; compare still opens. |

---

## TEST 2 — New user installs extension

| | |
|--|--|
| **Setup** | Clean Chrome profile (or Guest) |
| **Steps** | Install zip → open popup → land on product card (WB/Ozon/YM) → try compare once. |
| **Expect** | Empty tracks; default search MPs = WB+Ozon+YM (no test MPs forced on). First-run UX usable without crash. |
| **Verify** | Settings «Где искать» defaults; no leftover `tracked_products` for this device until user adds. |

---

## TEST 3 — Only one marketplace selected

| | |
|--|--|
| **Steps** | Settings → select **only Ozon** → save → run compare from a WB (or Ozon) card. |
| **Expect** | Compare targets = source MP + Ozon only (source always kept). No Megamarket/Ali/etc. |
| **Verify** | Progress / table columns only for allowed MPs; telemetry `marketplace_search_*` only for those ids. |

---

## TEST 4 — All marketplaces selected

| | |
|--|--|
| **Steps** | Enable all MPs that UI allows (intersect server `marketplace_enabled`). Run compare. |
| **Expect** | Search attempts for every **enabled** MP. Disabled-by-server MPs absent even if locally toggled earlier. |
| **Verify** | Settings list matches Edge `marketplace-flags` GET; no hang forever — failures surface per MP. |

---

## TEST 5 — One marketplace returns 502

| | |
|--|--|
| **Setup** | Hard without staging mock: pick a flaky/test MP **or** temporarily break one Edge path in **non-prod**. Prefer observe natural 5xx in logs. |
| **Steps** | Run compare (or cron scrape) when one MP path returns 502. |
| **Expect** | Other MPs still complete. Failed MP = soft fail / empty offer — **no** false price-drop alert. No browser Scrappey storm on 5xx (Phase 7). |
| **Verify** | Soft backoff / `last_checked` updated; `last_price` kept; ops `scrape_*` reason for fail. |

---

## TEST 6 — Scrappey timeout

| | |
|--|--|
| **Setup** | Premium/trial user; product that needs Scrappey (or wait for unlocker path). |
| **Steps** | Trigger fetch that times out (~22s race). |
| **Expect** | Soft fail + cooldown. **No** second browser mode on timeout. Next cron does **not** scrape every tick until backoff expires (Phase 7). |
| **Verify** | Edge logs: ≤1 Scrappey attempt mode for that failure class; `consecutive_unavailable` / next check delayed. |

---

## TEST 7 — Same product, two Telegram users (dedup)

| | |
|--|--|
| **Setup** | T1 and T2 with Telegram monitoring on; same product URL (same bare id). Clear or note `price_scrape_cache.fetched_at` for that SKU. |
| **Steps** | T1 `/add <url>` → T2 `/add <url>` → force **one** stale cron/`update-prices` run. |
| **Expect** | **1 monitoring target** (`mp:id` group)<br>**1 scrape** (one live fetch if stale; else cache — note which)<br>**2 subscribers** (`deleted=false` rows) |
| **Verify** | SQL: 2 rows, same `marketplace`+`product_id`, different `user_id`. Cache: **one** row. Cron/logs: **one** `fetchMarketplacePriceDetailed` for the group. Economics: subscribers ≥2 for that target shape. |

```
PRODUCT (ozon:ID)
   → 1 MONITORING JOB
   → 1 SCRAPE (if stale)
   → fan-out → T1 + T2
```

---

## TEST 8 — One user removes the product

| | |
|--|--|
| **Setup** | Continue from TEST 7. |
| **Steps** | T1 deletes track (Telegram remove **or** extension delete synced to cloud). |
| **Expect** | T1 row `deleted=true` (or gone from active query). T2 still `deleted=false`. |
| **Verify** | SQL active count for SKU = **1**. |

---

## TEST 9 — Second user still monitors

| | |
|--|--|
| **Setup** | After TEST 8; make SKU stale again. |
| **Steps** | Run `update-prices` / wait cron. |
| **Expect** | **Scrape continues** (job still scheduled for remaining subscriber). T2 `last_checked` / price updates. T1 not alerted. |
| **Verify** | Group still in coalesce work queue; 1 scrape for the group. |

---

## TEST 10 — Last user removes product

| | |
|--|--|
| **Steps** | T2 deletes the product. Force cron. |
| **Expect** | **No monitoring job** for that SKU (no active `deleted=false` rows). **No new Scrappey** for it. Cache row may linger until TTL — must **not** alone schedule scrape. |
| **Verify** | SQL: 0 active subscribers. Cron work queue has no group for `mp:id`. |

---

## TEST 11 — Cache hit

| | |
|--|--|
| **Setup** | Fresh `price_scrape_cache` row (`fetched_at` within 6h TTL). Premium `/add` or cron while **not** stale. |
| **Steps** | Trigger price resolve (Telegram `/add`, Premium unlocker, or cron with fresh cache). |
| **Expect** | Response from cache; **no new live Scrappey/scrape**. |
| **Verify** | `fetched_at` unchanged; ops/logs path `cache` / no Scrappey call; Edge scrappey counter flat. |

---

## TEST 12 — Retry after error (no request storm)

| | |
|--|--|
| **Setup** | Induce soft fail (502/timeout) on one SKU (TEST 5/6). |
| **Steps** | Invoke cron **3–5 times in a short window** (or wait several ticks). |
| **Expect** | Backoff: SKU **not** scraped every run. Circuit after many soft fails in one run skips further Scrappey (Phase 7). **No** N×users × retries storm. |
| **Verify** | Count Scrappey/HTTP attempts in logs for that SKU ≪ number of cron invokes; `last_checked` advances on soft fail without clearing price. |

---

## TEST 13 — Free user hits track limit

| | |
|--|--|
| **Setup** | Free account (no paid, no active trial); server caps Free = **5**. |
| **Steps** | Add 5 tracks (extension sync and/or Telegram `/add`). Attempt 6th. |
| **Expect** | 6th rejected server-side (`TRACK_LIMIT` / upsert cap). UI may also block — **server is source of truth**. Free Telegram path: **no** interactive Scrappey (cache/legacy only). |
| **Verify** | DB ≤5 active tracks for `user_id`; error code/message on 6th; no unbounded `tracked_products` growth. |

---

## TEST 14 — Premium user

| | |
|--|--|
| **Setup** | Paid **or** active trial (`trial_claims`). |
| **Steps** | Add tracks up to well above 5 (e.g. 6–10, cap **50**). Trigger Premium unlocker / Telegram path that needs Scrappey. |
| **Expect** | Tracks allowed within 50. Scrappey allowed for unlocker / Premium Telegram flows. Cron treats trial as Premium freshness tier. |
| **Verify** | Insert succeeds; Edge `fetch-product-price` / unlocker OK with auth; Free-only blocks do not apply. |

---

## TEST 15 — Server flag disables monitoring

| | |
|--|--|
| **Setup** | Pick a MP that is compare-capable (e.g. pilot Megamarket **or** temporarily set flag on a test MP in **non-prod**). |
| **Steps** | Set `monitoring_enabled = false` (keep `marketplace_enabled = true` if testing compare-only). Try Telegram `/add` for that MP URL. Confirm cron does not scrape that MP. Optionally: compare still works if `marketplace_enabled`. |
| **Expect** | `/add` → monitoring disabled message. `update-prices` skips groups for that MP. Compare may still run if compare flag on. |
| **Verify** | `select * from marketplace_flags where marketplace_id = '…'`; Edge `marketplace-flags` GET; no new scrapes for that MP in cron. **Restore flags after test** (do not leave prod core trio off). |

```sql
-- Example compare-only (restore after!)
update public.marketplace_flags
set monitoring_enabled = false, updated_at = now()
where marketplace_id = 'megamarket';
```

---

## Suggested run order

```
1 → 2 → 3 → 4          # install / compare settings
13 → 14                # plan caps (can parallel on two accounts)
7 → 8 → 9 → 10         # shared monitoring story (must be sequential)
11 → 5 → 6 → 12        # cache then failure/backoff
15                     # flags last; restore DB
```

---

## Results template

| # | Result | Evidence (SQL / log time / screenshot) | Notes |
|---|--------|------------------------------------------|-------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | 1 target / 1 scrape / 2 subs | |
| 8 | | | |
| 9 | | | |
| 10 | | | |
| 11 | | cache hit, fetched_at= | |
| 12 | | attempt count= | |
| 13 | | | |
| 14 | | | |
| 15 | | flags restored? Y/N | |

**Release gate:** TESTS **7–11**, **13–14**, and **1–2** must PASS before CWS upload. 5/6/12/15 may be staging-only if prod induction is unsafe.

---

## Out of scope (do not block on these here)

- Live SEO sitemap crawl (Phase 14 Vercel redeploy)
- AI Free 3/day client quota
- Rotating production secrets
