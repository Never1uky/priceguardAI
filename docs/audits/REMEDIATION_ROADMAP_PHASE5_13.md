# PriceGuard AI — Remediation Roadmap (Phases 5–13)

Status at time of writing:
- Phase 1 (YooKassa webhook) — already fixed independently in repo (verified, see chat evidence).
- Phase 2 (broken imports) — already fixed independently in repo (verified).
- Phase 3 (brightdata key) — investigated; SCRAPPEY_API_KEY already application-level
  and correctly stored; legacy `brightdata_api_key`/`brightdata_zone` columns are dead
  code, marked DEPRECATED, cleanup is a pending decision (needs manual DB check first).
- Phase 4 (metrics fail-closed) — DONE this session: code was already fail-closed;
  found and replaced a stale/misleading duplicate test that asserted the old
  fail-open behavior. 7 new tests, full suite green (558 passed).

This document plans **only** — nothing below is executed yet. Each stage will be
its own message/turn, with its own evidence-first investigation, its own isolated
diff, and its own test run, per the standing rules (no batching, no big refactor,
no deploy, no production data changes, no automatic secret rotation).

---

## Recommended order and reasoning

Ordered by: (a) risk if left alone, (b) whether it's a pure investigation/doc vs.
a code change, (c) dependencies between stages.

| Order | Phase | Type | Why this position |
|---|---|---|---|
| 1 | **Phase 11 — Duplicate cron** | Investigation + small code change | Directly operational (you already reported real failures from this). Independent of everything else. Cheapest to verify (just check pg_cron dashboard state) before touching update-prices further. |
| 2 | **Phase 9 — Device claim ownership** | Investigation + migration plan (no execution) | Security-relevant (IDOR-adjacent), but low real-world exploitability already established. Needs a migration STRATEGY before any schema change — good candidate to plan now while it's fresh from earlier discussion. |
| 3 | **Phase 5 — Retention engine (doc)** | Documentation only | Needs Phases 6/7/8 findings as input, so do it first as the umbrella doc, then fill in per-table decisions as 6/7/8 land. Zero code risk — pure inventory. |
| 4 | **Phase 8 — Telegram product sessions lifecycle** | Investigation + small migration proposal | Small, self-contained table, good warm-up before the bigger reviews question. |
| 5 | **Phase 7 — Cross-market mapping TTL** | Investigation + TTL proposal | Same shape as Phase 8, slightly more business-logic nuance (confidence/match score affects retention). |
| 6 | **Phase 6 — Raw reviews minimization** | Investigation + migration plan (no execution) | The most consequential data-minimization decision (author names, full text) — deliberately done after the smaller retention stages so the general pattern (soft TTL vs hard delete vs field-level minimization) is already agreed on a simpler table first. |
| 7 | **Phase 10 — Unified cleanup mechanism** | Code (new Edge Function + cron) | Needs Phases 5/6/7/8 TTL decisions finalized first — this is the engine that enforces them. Building it before the TTLs are agreed would mean rework. |
| 8 | **Phase 12 — Regression testing / tests/security/** | Code (tests only) | Rolls up tests from all prior stages into a dedicated `tests/security/` folder, plus fills gaps (yookassa-webhook, ownership, retention, cache-isolation) not yet covered as standalone security tests. |
| 9 | **Phase 13 — Final review table** | Documentation only | Last — needs everything above finished to be accurate. |

---

## Per-stage scope (what each future message will actually do)

### Stage A — Phase 11: Duplicate cron
- Evidence-gather: is `pg_cron` job `priceguard-update-prices` actually enabled in
  the live project? (REQUIRES MANUAL VERIFICATION — I'll give you the exact SQL to
  run in Supabase SQL Editor to check, not run it myself.)
- If both are confirmed active: propose keeping `pg_cron` as source of truth
  (better observability inside Postgres, no GitHub Actions secret to rotate) with
  GitHub Actions offset in time as a true backup, OR the reverse — decision depends
  on what you tell me about current reliability preferences.
- Add an advisory lock (`pg_try_advisory_lock`) at the top of `update-prices`
  so even if both fire, only one does real work. Small, isolated diff.
- Tests: lock-acquisition unit test (mocked Supabase RPC), no e2e needed.

### Stage B — Phase 9: Device claim ownership
- Re-confirm current impact (already established: low, UUID v4, no leak path found).
- Deliverable: a **migration strategy document** (not a migration) proposing one of:
  a) require the claim to happen only immediately after anonymous→authenticated
     sign-up (session-adjacent, no standalone "claim by ID" endpoint exposed later), or
  b) a short-lived signed claim token issued at anonymous session creation, exchanged
     once at sign-up.
- Explicitly: no schema change, no code change in this stage — plan only, per your
  "не ломать существующих пользователей" requirement, this needs your sign-off on
  which UX flow before any implementation.

### Stage C — Phase 5: `docs/architecture/DATA_RETENTION.md` (skeleton)
- Full inventory table (already have most of the raw facts from the earlier audit).
- Columns left as `DECISION REQUIRED` for anything whose TTL depends on product/business
  logic I can't infer from code alone (e.g., how long should a confirmed high-confidence
  cross-market mapping live vs. an unconfirmed one).

### Stage D — Phase 8: `telegram_product_sessions`
- Full lifecycle already partially known; finalize creation/read/update/delete call
  sites, propose TTL + cleanup, flag anything DECISION REQUIRED.

### Stage E — Phase 7: `cross_market_mapping`
- Same shape, plus explicit handling of the "user-confirmed match" case you flagged
  as needing its own retention policy.

### Stage F — Phase 6: `product_cache.raw_reviews`
- Concrete minimization proposal (drop `author`, keep hash instead of full text where
  only used for re-analysis triggers, etc.), presented as a migration **plan** with
  before/after row shape — not executed without your explicit go-ahead, since this
  touches real stored data.

### Stage G — Phase 10: Unified cleanup mechanism
- One new Edge Function (e.g. `cache-cleanup`), idempotent, batch-based, with
  `deleted_count`/`failed_count`/`duration_ms` logged to a small metrics table or
  the existing `ai_request_log`-style pattern. Scheduled via the single cron source
  of truth decided in Stage A.

### Stage H — Phase 12: `tests/security/`
- New folder, consolidating: `yookassa-webhook`, `metrics-auth` (already have this,
  will move/reference), `ownership` (device claim), `retention` (cleanup mechanism),
  `cache-isolation` (confirm User A can't read User B's data via any shared-cache path).

### Stage I — Phase 13: Final review table
- The `| Issue | Before | After | Evidence | Test |` table for all 10 original
  findings, fully updated.

---

## What I need from you to proceed efficiently

Two decisions would remove guesswork later (not blocking — I can flag as DECISION
REQUIRED and continue if you'd rather decide later):

1. For Stage A: do you have a preference between pg_cron vs GitHub Actions as the
   single source of truth, or should I just recommend based on technical merit?
2. For Stage F: is `raw_reviews.author` used anywhere downstream (e.g. shown to
   users, used in AI prompt for tone), or was it captured incidentally? This
   changes whether the fix is "drop the field" (simple) vs "keep but restrict
   access" (more work).

Say which stage to start with (A is my recommendation), or reorder — this is a
proposal, not a commitment.
