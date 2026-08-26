# STEP 6 — Database audit (Megamarket CHECK / migration)

**Date:** 2026-08-26  
**Project:** PriceGuardAI (`ihlfvpocwobvcpxbypsd`)  
**No schema/code fixes applied** (audit only).

---

## 1. P0 migration file (repo)

[`supabase/migrations/20260826140000_megamarket_tracked_check.sql`](supabase/migrations/20260826140000_megamarket_tracked_check.sql)

| Table | Intended CHECK after migrate |
|-------|------------------------------|
| `tracked_products` | `wildberries`, `ozon`, `yandex_market`, **`megamarket`** |
| `product_price_history` | same |

Properties:

- Additive allowlist only (DROP + ADD CHECK).
- Does **not** rewrite old migrations.
- Existing WB/Ozon/YM values remain valid (superset).
- Does **not** flip monitoring/Scrappey flags.

### Production apply status

`list_migrations` on prod: **no** `20260826140000_megamarket_tracked_check`.

Live CHECK defs (queried):

| Table | Production CHECK today |
|-------|------------------------|
| `tracked_products` | trio **only** (no megamarket) |
| `product_price_history` | trio **only** (no megamarket) |

→ Migration exists in repo, **not applied** on production.

---

## 2. Migration correctness (design review)

| Check | Result |
|-------|--------|
| Mega allowed where P0 needs cloud track | **Designed YES** — not live until apply |
| Old WB/Ozon/YM still allowed | **YES** (additive IN-list) |
| INSERT/UPDATE/DELETE semantics | Unchanged except Mega newly allowed after apply |
| Safe for prod | **YES** if applied (no data rewrite) |

**INSERT/UPDATE after apply (expected):**

- `marketplace IN (trio + megamarket)` → OK  
- Unknown MP (e.g. `lamoda`) → still rejected on these two tables  

**DELETE:** unaffected by CHECK.

---

## 3. Runtime blockers for Mega cloud track (beyond migration)

Even **after** applying the SQL migration, cloud sync still has an Edge gate:

| Layer | File | Behavior | Severity |
|-------|------|----------|----------|
| DB CHECK (prod today) | `tracked_products_marketplace_check` | Rejects `megamarket` INSERT | **P0 BLOCKER** for cloud Mega track until migrate |
| Edge allowlist | `supabase/functions/tracked-sync/index.ts` `VALID_MARKETPLACES = trio` | **Silently skips** Mega push (`continue`) | **P0 / HIGH** — blocks Mega sync even after CHECK widen |
| Upsert helper | `tracked-upsert.ts` | Accepts `string` marketplace; no enum reject | OK once callers allow |

**Local-only** tracked Mega (chrome.storage) can work without DB; **cloud sync / multi-device** cannot until migrate **and** Edge allowlist include Mega.

`product_price_history`: typically written from Telegram/server paths for CORE; Mega cron does not scrape, so history CHECK is lower urgency unless a writer starts inserting Mega history.

---

## 4. Remaining trio-only CHECKs (production live list)

Do **not** auto-fix. Queried from `pg_constraint`:

| # | Table | Constraint | Columns | Mega? | Runtime impact if Mega used |
|---|-------|------------|---------|-------|-----------------------------|
| 1 | `tracked_products` | `tracked_products_marketplace_check` | `marketplace` | **Blocked** | **P0 BLOCKER** — cloud track sync |
| 2 | `product_price_history` | `product_price_history_marketplace_check` | `marketplace` | **Blocked** | **HIGH** if history writer for Mega; else deferred |
| 3 | `price_scrape_cache` | `price_scrape_cache_marketplace_check` | `marketplace` | Blocked | N/A P0 — no Mega Scrappey/cache writes |
| 4 | `product_cache` | `product_cache_marketplace_check` | `marketplace` | Blocked | P2 — AI cache for Mega card |
| 5 | `search_metrics` | `search_metrics_marketplace_check` | `marketplace` | Blocked | **P2** — client may report Mega search metrics → INSERT fail (soft) |
| 6 | `telegram_product_sessions` | `telegram_product_sessions_marketplace_check` | `marketplace` | Blocked | N/A — TG doesn’t parse Mega |
| 7 | `authenticity_events` | `authenticity_events_marketplace_check` | `marketplace` | Blocked | N/A for Mega P0 |
| 8 | `seo_product_pages` | `seo_product_pages_marketplace_check` | `marketplace` | Blocked | Intentional — SEO not READY |
| 9 | `search_results_cache` | `search_results_cache_marketplace_check` | `marketplace` | Blocked | Agent search — Mega not in agent |
| 10 | `cross_market_mapping` | `…_source_marketplace_check` | `source_marketplace` | Blocked | P2 if shared mapping for Mega |
| 11 | `cross_market_mapping` | `…_target_marketplace_check` | `target_marketplace` | Blocked | same |
| 12 | `match_feedback` | `…_source_marketplace_check` | `source_marketplace` | Blocked | P2 feedback from Mega compares |
| 13 | `match_feedback` | `…_target_marketplace_check` | `target_marketplace` | Blocked | same |
| 14 | `mapping_moderation_events` | `…_source_marketplace_check` | `source_marketplace` | Blocked | P2 |
| 15 | `mapping_moderation_events` | `…_target_marketplace_check` | `target_marketplace` | Blocked | P2 |

### Already widened (includes megamarket)

| Table | Constraint |
|-------|------------|
| `telemetry_events` | `telemetry_events_marketplace_check` (null \| trio + megamarket + test MPs) |

### No marketplace CHECK (relevant)

| Table | Notes |
|-------|-------|
| `marketplace_flags` | PK text; Mega seeded |
| `compare_products` | payload jsonb — OK for Mega compare sync |
| `monitoring_cost_guards` | arrays; TS parses CORE-only |

---

## 5. Existing CORE data

- Additive CHECK cannot invalidate existing `'wildberries'|'ozon'|'yandex_market'` rows.
- Sample: live `tracked_products` still trio-constrained; no Mega rows expected to exist yet.
- **Do not** run destructive DELETE/UPDATE on CORE for this audit.

---

## 6. Findings by severity

### P0 BLOCKER

1. **Production CHECK** on `tracked_products` still trio-only — Mega cloud INSERT fails.  
2. **Migration not applied** (`20260826140000_…` missing from prod migration list).  
3. **`tracked-sync` Edge `VALID_MARKETPLACES`** still trio — Mega push silently ignored (**code**, not CHECK; still blocks Mega cloud runtime).

### P1 HIGH

4. `product_price_history` still trio on prod — blocks Mega history if any writer emits it after track.

### P2 MEDIUM (intentionally out of P0 widen)

5. `search_metrics` — Mega compare search metric inserts may fail.  
6. Mapping / match_feedback / SEO / price_scrape_cache / product_cache / agent cache — leave for later MPs / features.

### P3 LOW

7. Fragile pattern: ~15 CHECKs to touch per new MP (document for P2/P3 enum strategy).

---

## 7. Minimal fix set (**propose only — do not apply in this step**)

1. Apply `20260826140000_megamarket_tracked_check.sql` on prod.  
2. Verify:

```sql
-- expect megamarket in both
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN (
  'tracked_products_marketplace_check',
  'product_price_history_marketplace_check'
);
```

3. Smoke (transaction rollback or delete after): INSERT Mega tracked row → UPDATE → soft DELETE. Confirm trio rows untouched.  
4. Separately (code change, needs approval): add `'megamarket'` to `tracked-sync` `VALID_MARKETPLACES`.  
5. **Do not** widen the other trio CHECKs in the same change.

---

## Verdicts (Step 6)

| Gate | Result |
|------|--------|
| Migration **design** | **PASS** |
| Migration **applied on prod** | **FAIL** |
| Mega allowed on tracked/history **in prod** | **FAIL** |
| CORE data safety of designed migration | **PASS** |
| Remaining trio CHECKs inventoried | **15 constraint rows / 11 tables** (+ telemetry already wide) |
| **DATABASE** overall | **FAIL** until migrate + Edge allowlist |

**Blocking Mega cloud track runtime today:** yes — DB CHECK + Edge VALID list.
