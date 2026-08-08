# PriceGuard AI — Data Retention Architecture
Stage C of docs/audits/REMEDIATION_ROADMAP_PHASE5_13.md — Phase 5.

Evidence-based inventory of all 22 tables currently in `supabase/migrations/`,
their purpose, actual TTL (if any), whether physical deletion happens, and by
what mechanism. Built from the live schema, not from memory of the earlier
audit — several tables and one purge mechanism were added since then.

**No code/schema changed in this stage — inventory + policy only.**

---

## Existing physical cleanup mechanism (already in production code)

`supabase/migrations/20260717210000_privacy_ttl_purge.sql` defines
`public.purge_privacy_ttl_data()`, callable via `supabase/scripts/setup-privacy-purge-cron.sql`
(daily 03:15 UTC). It currently purges:

| Table | Rule |
|---|---|
| `telegram_ai_threads` | `expires_at < now()` |
| `product_cache` | `last_updated < now() - 7 days` |
| `price_scrape_cache` | `fetched_at < now() - 2 hours` |
| `ai_request_log` | `created_at < now() - 90 days` |
| `search_metrics` | `created_at < now() - 90 days` |

**REQUIRES MANUAL VERIFICATION:** whether `priceguard-privacy-ttl-purge` is
actually scheduled in the live `cron.job` table (same caveat as the
`update-prices` cron in Stage A) — the migration only creates the function;
`setup-privacy-purge-cron.sql` must be run once in the SQL Editor to schedule it.
Run this to check:
```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'priceguard-privacy-ttl-purge';
```

---

## Full inventory

| Table | Data | Purpose | TTL | Physical Delete | Cleanup |
|---|---|---|---|---|---|
| `product_cache` | Full review text + author, AI analysis, shared across users by (marketplace, product_id) | Avoid re-scraping/re-analyzing the same product | 7 days | **Yes** | `purge_privacy_ttl_data()` |
| `price_scrape_cache` | Scraped price/title/url, shared | Short-lived price cache to cut Scrappey calls | 2 hours | **Yes** | `purge_privacy_ttl_data()` |
| `telegram_ai_threads` | Q&A turns with AI, per chat_id | Rolling Telegram bot conversation context | 48h (own `expires_at`) | **Yes** | `purge_privacy_ttl_data()` |
| `ai_request_log` | Provider/model/duration metadata only (no prompt/response body) | AI usage metrics | 90 days | **Yes** | `purge_privacy_ttl_data()` |
| `search_metrics` | Search/match metrics | Product analytics | 90 days | **Yes** | `purge_privacy_ttl_data()` |
| `cross_market_mapping` | WB↔Ozon/YM product ID mapping, confidence, shared | Skip re-matching for subsequent users | **None** | No | **GAP — not in purge function** |
| `telegram_product_sessions` | Current product per Telegram chat | Bot conversation state | **None** | No | **GAP — not in purge function** |
| `edge_request_log` | endpoint, user_id/device_id, timestamp | Rate limiting (recent-request lookback only) | **None** | No | **GAP** — code only ever queries a recent window; old rows have zero functional use |
| `mapping_moderation_events` | user_id, dispute/reportFail action, source/target IDs | 24h dispute-cooldown lookup (`cross-market-map/index.ts:355`: `since = now() - 24h`) | **None** | No | **GAP** — cooldown logic itself only looks back 24h, so retention beyond ~48h serves no function |
| `mapping_promotion_audit` | Promotion decision + reason, no user_id | "Optional diagnostics" per its own comment | **None** | No | Low sensitivity (no user_id), but unbounded growth — candidate for same 90-day policy as `ai_request_log`/`search_metrics` |
| `telemetry_events` | level, stage, error_message, session_id, trace_id, optional user_id | Opt-in client WARN/ERROR telemetry | **None** | No | **GAP** — contains session_id/trace_id, no retention at all |
| `product_price_history` | user_id, marketplace, product_id, price, timestamp | Price history charts (Telegram "История цены") | **DECISION REQUIRED** — how far back should charts go? | No | Depends on product decision |
| `seo_product_pages` | Public product snapshot for SEO pages | Public marketing content | **DECISION REQUIRED** — content-freshness policy, not privacy | No | Not a privacy concern (public data by design), but stale/unpublished pages could accumulate |
| `tracked_products` | user_id/device_id, marketplace, product_id, OOS backoff state | Core watchlist feature | Lives with the account | Cascade via `on delete cascade` from `auth.users` (assumed — see Open Question below) | User-initiated delete; OOS backoff already added (unrelated to this doc) |
| `compare_products` | user_id, product_id, comparison payload, soft `deleted` flag | Comparison list feature | Lives with the account | `on delete cascade` from `auth.users` | Soft-delete flag exists but no hard-delete/vacuum of soft-deleted rows found |
| `trial_claims` | user_id, device_id, telegram_chat_id, expires_at | **Anti-abuse record** — one trial per device/chat | Intentionally **permanent** | **No — by design** | Not a gap: deleting this would let the same device/chat re-claim a trial. Its own `expires_at` governs trial *validity*, not record lifetime. |
| `payments`, `license_keys`, `license_activations`, `user_premium` | Financial/subscription records | Billing, entitlement | **DECISION REQUIRED** — likely legal/accounting retention (RU accounting law typically wants years, not days) | No | Out of scope for a TTL-based purge — needs an explicit retention policy, not engineering default |
| `user_alert_settings` | Telegram chat_id, alert thresholds, legacy plaintext `brightdata_api_key`/`brightdata_zone` (deprecated, unused — see Stage/Phase 3 finding) | User preferences | Lives with the account | `on delete cascade` (assumed) | Legacy columns still a separate cleanup decision (Phase 3, already documented) |
| `update_prices_run_lock` | Single row, lease state | Cron/GH Actions duplicate-run lock | N/A (1 row, always overwritten) | N/A | Not user data |
| `authenticity_events`, `match_feedback` | Product authenticity signals, user match votes (`match_feedback.user_id` added later) | Product-quality signals | **None** | No | Same shape as `mapping_promotion_audit` — low sensitivity, unbounded growth, candidate for 90-day policy |

---

## Open question (blocks a fully accurate row above)

I could not confirm from the migrations I read whether `tracked_products`,
`compare_products`, `user_alert_settings`, `user_premium`, `payments`, etc.
actually have `on delete cascade` wired to `auth.users` in every case — some
were declared that way explicitly (`compare_products`, `product_price_history`,
`trial_claims`), others I inferred by pattern. **REQUIRES MANUAL VERIFICATION**:
run this to get the authoritative list of what actually cascades on account
deletion vs. what would be orphaned:
```sql
select
  tc.table_name, kcu.column_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
join information_schema.constraint_column_usage ccu
  on rc.unique_constraint_name = ccu.constraint_name
where ccu.table_name = 'users' and ccu.table_schema = 'auth';
```
This also directly answers Phase 20 ("проверить удаление аккаунта / orphaned data")
from the original mega-prompt, which nothing so far has covered.

---

## Summary — what's a real gap vs. what's fine as-is

**Real gaps (technically-justified TTL, not a business decision — I can propose
exact values next stage if you want them acted on):**
- `cross_market_mapping` — no TTL at all (Phase 7, planned as its own stage)
- `telegram_product_sessions` — no TTL at all (Phase 8, planned as its own stage)
- `edge_request_log` — rate-limit log with no retention; recommend ~72h
- `mapping_moderation_events` — cooldown log with no retention; code only reads
  a 24h window, so recommend ~48h (safety margin) then purge
- `telemetry_events` — contains session_id/trace_id, zero retention

**Fine as-is / not a gap:**
- `trial_claims` — permanence is intentional (anti-abuse)
- `update_prices_run_lock` — not user data
- `product_cache`, `price_scrape_cache`, `telegram_ai_threads`, `ai_request_log`,
  `search_metrics` — already covered by `purge_privacy_ttl_data()`

**DECISION REQUIRED (business/legal, not mine to set):**
- `product_price_history` — how far back should price charts go?
- `payments`/`license_keys`/`license_activations`/`user_premium` — accounting/legal
  retention minimums (RU law) likely apply; don't want to arbitrarily shorten these.
- `seo_product_pages` — content freshness, not privacy.

---

## Next stages that build on this doc

- **Stage D (Phase 8)** — `telegram_product_sessions` TTL + cleanup.
- **Stage E (Phase 7)** — `cross_market_mapping` TTL + cleanup, including the
  "user-confirmed high-confidence mapping" retention nuance you flagged earlier.
- **Stage F (Phase 6)** — `product_cache.raw_reviews` minimization (author field etc.)
- **Stage G (Phase 10)** — extend `purge_privacy_ttl_data()` to also cover
  `edge_request_log`, `mapping_moderation_events`, `telemetry_events`, and
  whatever TTLs Stages D/E land on, with the observability (deleted_count/
  duration/last_success) Phase 10 asked for — the current function returns
  counts in its jsonb result but nothing persists them across runs; `pg_cron`'s
  own `cron.job_run_details` table gives basic run history but not the
  per-table breakdown. Worth a small addition once the TTLs above are final.
