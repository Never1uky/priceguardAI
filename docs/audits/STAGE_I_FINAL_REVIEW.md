# PriceGuard AI — Final Security Remediation Review
Stage I of docs/audits/REMEDIATION_ROADMAP_PHASE5_13.md — Phase 13.

Re-verified against `main` at commit `0c0512e` (2026-08-08 00:08:33 +0300) plus
the sandbox changes from Stages A, D, G, H (not yet pushed — see checklist).

---

## Original 10 findings — final status

| # | Issue | Before | After | Evidence | Test | Status |
|---|---|---|---|---|---|---|
| 1 | CRITICAL — YooKassa webhook forgeable | No signature/API verification; webhook body trusted directly | Re-fetches payment from YooKassa API (`fetchYookassaPayment`), checks `status/currency/amount` against server-side `PLAN_PRICES` + stored row, user_id from own DB row not body | `supabase/functions/yookassa-webhook/index.ts` (verified independently implemented upstream, not by me) | `tests/security/yookassa-webhook.test.ts` (5+8 assertions) | **FIXED** |
| 2 | CRITICAL — broken imports in update-prices/marketplace-prices.ts | `price-identity.ts`, `premium-active.ts`, `product-cache-store.ts`, `scrappey.ts` referenced but absent | All 4 files exist with real implementations + their own tests, deployed independently of this session | `check-edge-imports.mjs` → OK 79 files; `.github/workflows/edge-functions-check.yml` added | `premium-active.test.ts`, `price-identity.test.ts`, `scrappey.test.ts` (pre-existing) | **FIXED** |
| 3 | HIGH — `product_cache.raw_reviews` retained indefinitely | 7-day TTL was "soft" only (no physical delete found) | `purge_privacy_ttl_data()` physically deletes rows `last_updated < 7 days`. **Correction from original audit:** traced full write path — `author` field was never actually persisted to this column (only plain-text `string[]`), so no minimization needed there (Stage F). Full-text-vs-hash minimization considered and explicitly declined by you (Stage F). | `supabase/migrations/20260717210000_privacy_ttl_purge.sql` | `tests/security/retention.test.ts` | **FIXED** (retention); minimization **DECLINED BY DECISION**, not a gap |
| 4 | HIGH — `brightdata_api_key` plaintext | Column existed, unclear if used | Confirmed dead code (no read/write path anywhere in `src/` or `supabase/functions/`), formally marked `DEPRECATED` in migration comment; real active credential is `SCRAPPEY_API_KEY`, which was already correctly stored as a Supabase secret (never DB/frontend/logs) | `supabase/migrations/20260717200000_scrappey_source.sql` | N/A (no code path to test — that's the point) | **PARTIALLY_FIXED** — dead code path confirmed harmless; whether the column still holds **residual plaintext values from before deprecation** in production is **REQUIRES_MANUAL_ACTION** (SQL check given in Stage 3 of this engagement, never run by either of us) |
| 5 | HIGH — `canAccessMetrics()` fail-open | `list.length === 0 → true` (grants access to any authenticated user) | `list.length === 0 → false`. Also found and fixed a **stale duplicate test** (`src/lib/supabase/metrics-access.test.ts`) that asserted the old fail-open behavior as correct — replaced with a real test against the actual function | `supabase/functions/_shared/metrics-access.ts:15` | `metrics-access.test.ts` (7), `tests/security/metrics-auth.test.ts` (4) | **FIXED** |
| 6 | MEDIUM — `cross_market_mapping` no TTL | No expiry at all | Investigated in depth (Stage E): table has a status machine (`active`/`disputed`/`dead`/`unverified`) that already prevents stale mappings from being served; `dead`/`disputed` rows are a **permanent blacklist by design** — deleting them would be a behavior change (could let a bad auto-match recur), not just cleanup. No PII on this table. **Recommendation: no TTL**, differs from original audit's framing | `cross-market-map/index.ts:99-118` (active-only lookup), `:175-230` (disputed/dead never auto-revived) | N/A — decision, not a bug | **REVIEWED — NOT_FIXED BY DESIGN** (evidence shows original "gap" framing was wrong) |
| 7 | MEDIUM — `telegram_product_sessions` no TTL | No expiry | 30-day inactivity TTL added, derived from actual usage pattern (single-row-per-chat pointer, zero value once stale) | `supabase/migrations/20260808100000_purge_telegram_product_sessions.sql` | `tests/security/retention.test.ts` | **FIXED** (pending push — see checklist) |
| 8 | MEDIUM — `claim_tracked_products_by_device` unverified device_id | Flagged as IDOR-risk | Full threat model built (Stage B): `user_id` always from verified JWT (can't impersonate an account); `device_id` is `crypto.randomUUID()` (122 bits), never exposed via any client UI or API response; claim is one-shot (row's `device_id` nulled after claim, can't be re-claimed). Real impact: theft of a **pre-signup watchlist only**, no PII/payment reachable. **You chose Option A (no change)** | `docs/audits/STAGE_B_DEVICE_CLAIM.md` | `tests/security/ownership.test.ts` | **REVIEWED — RISK ACCEPTED** (your decision, documented) |
| 9 | MEDIUM — no confirmed physical cleanup | No cron/cleanup job found anywhere | `purge_privacy_ttl_data()` exists and now covers 9 tables total (5 original + telegram_product_sessions, edge_request_log, mapping_moderation_events, telemetry_events added this engagement) | `supabase/migrations/20260717210000_privacy_ttl_purge.sql` + Stages D/G additions | `tests/security/retention.test.ts` | **FIXED in code**; whether `priceguard-privacy-ttl-purge` pg_cron job is actually **scheduled and running** in production is **REQUIRES_MANUAL_ACTION** — SQL check given, never confirmed by you |
| 10 | MEDIUM — duplicate update-prices cron | pg_cron and GitHub Actions both `0 */6 * * *` | GitHub Actions offset to `20 */6 * * *`; lease lock (`try_acquire_update_prices_lock`/`update_prices_run_lock`) added and wired into `update-prices/index.ts` so even simultaneous fires only do the work once. Decision logic extracted to `decideUpdatePricesLock()` for direct testability | `supabase/functions/_shared/update-prices-policy.ts`, `supabase/migrations/20260805180100_update_prices_run_lock.sql` (pre-existing, verified) | `update-prices-policy.test.ts` (14, incl. 5 new lock tests) | **FIXED** |

**Score: 6 FIXED, 1 partially fixed (needs a manual DB check), 2 reviewed-and-resolved-by-decision (not bugs), 1 fixed-in-code-pending-manual-cron-confirmation.**
Zero items remain genuinely unaddressed.

---

## 1. Изменённые файлы (this engagement, not yet pushed — see checklist)

```
supabase/functions/_shared/auth.ts                    (re-exports from metrics-access.ts)
supabase/functions/_shared/metrics-access.ts           (NEW — extracted pure fn)
supabase/functions/_shared/update-prices-policy.ts     (added decideUpdatePricesLock)
supabase/functions/update-prices/index.ts              (uses decideUpdatePricesLock)
vitest.config.ts                                       (include: + supabase/functions, + tests/)
```

## 2. Изменения БД
None applied by me directly — only migration *files* prepared (see below). No
`db push` was run by me at any point; you ran it once yourself (Stage: the
`db push` error / `seo_view_count` conversation), unrelated to my files.

## 3. Новые migrations
```
supabase/migrations/20260808100000_purge_telegram_product_sessions.sql
supabase/migrations/20260808110000_purge_edge_logs_and_telemetry.sql
```

## 4. Новые tests
```
supabase/functions/_shared/metrics-access.test.ts
supabase/functions/_shared/update-prices-policy.test.ts   (extended, +5)
tests/security/yookassa-webhook.test.ts
tests/security/metrics-auth.test.ts
tests/security/ownership.test.ts
tests/security/retention.test.ts
tests/security/cache-isolation.test.ts
```
Deleted: `src/lib/supabase/metrics-access.test.ts` (stale duplicate, asserted wrong behavior).

Current full suite: **584 passed, 0 failed, 13 skipped** (`npx vitest run`).
`tsc --noEmit`, `eslint .`, `npm run build` all clean. `deno check` not
runnable in this sandbox — REQUIRES CI VERIFICATION on your GitHub Actions.

## 5. Security improvements (this engagement's actual contribution)
- Confirmed (not authored) the YooKassa and broken-imports fixes are real and correct.
- Fixed a genuinely fail-open→fail-closed regression risk: the stale metrics-access test.
- Added lock-decision test coverage that didn't exist for the duplicate-cron protection.
- Added physical TTL cleanup for 4 more tables (telegram_product_sessions, edge_request_log, mapping_moderation_events, telemetry_events).
- Corrected two audit inaccuracies with evidence rather than silently "fixing" non-bugs (raw_reviews.author was never stored; cross_market_mapping's dead/disputed status is an intentional permanent guardrail, not a stale-data gap).
- Built a `tests/security/` regression suite that will catch future regressions on all of the above.

## 6. Remaining risks
- `brightdata_api_key` may hold residual plaintext values from before deprecation — unverified.
- `cross_market_mapping` `dead`/`disputed` rows accumulate forever (accepted trade-off, not urgent — no PII).
- `product_cache.raw_reviews` stores full review text (not just hash) for 7 days — accepted by your decision in Stage F.
- Device-claim device_id-as-bearer pattern remains (accepted by your decision in Stage B).
- Two divergent `getDeviceId()` implementations found in `src/lib/supabase/` vs `src/lib/subscription/` (Stage H side-finding) — not investigated further, unclear if intentional.
- `payments`/`license_keys`/`user_premium`/`product_price_history`/`seo_product_pages` retention is explicitly **DECISION REQUIRED** from you (legal/business, not engineering) — untouched.

## 7. Manual actions required (from you, not automatable by me)
1. Run in Supabase SQL Editor: confirm whether `user_alert_settings.brightdata_api_key`/`brightdata_zone` hold any non-null values in production (Phase 3 finding).
2. Run in Supabase SQL Editor: confirm `priceguard-privacy-ttl-purge` and `priceguard-update-prices` pg_cron jobs are both `active = true` (Stage A / Stage C queries already given).
3. Decide retention for `payments`/`license_keys`/`user_premium` (likely RU accounting-law driven, not mine to set).
4. Decide retention for `product_price_history` (product decision — how far back should price charts go).
5. Confirm `deno check` passes in your actual CI (I could not run it in this sandbox).

## 8. Deployment checklist
Consolidating everything from this whole engagement that still needs to go
from my sandbox into your real repo + Supabase project:

**Migrations** (`supabase db push`, in order):
```
20260808100000_purge_telegram_product_sessions.sql
20260808110000_purge_edge_logs_and_telemetry.sql
```

**Edge Functions** (`supabase functions deploy <name>`):
```
metrics-dashboard   (uses _shared/auth.ts → _shared/metrics-access.ts)
update-prices        (uses _shared/update-prices-policy.ts's decideUpdatePricesLock)
```

**Commit only, no deploy needed:**
```
vitest.config.ts
supabase/functions/_shared/metrics-access.ts
supabase/functions/_shared/metrics-access.test.ts
supabase/functions/_shared/update-prices-policy.test.ts
tests/security/*.test.ts (5 files)
docs/architecture/DATA_RETENTION.md
docs/audits/STAGE_B_DEVICE_CLAIM.md
docs/audits/REMEDIATION_ROADMAP_PHASE5_13.md
docs/audits/YOOKASSA_REMEDIATION_PLAN.md (historical — real fix diverged, kept for record)
```

**Delete:**
```
src/lib/supabase/metrics-access.test.ts
```

**After deploying**, re-run the 3 manual-verification SQL queries above to close
out items #4 and #9's REQUIRES_MANUAL_ACTION status.

---

This closes the roadmap (Phases 1–13 as scoped in the original mega-prompt).
No deploy, no production data change, no secret rotation, no Privacy Policy
change was performed by me at any point in this engagement, per your standing
rules.
