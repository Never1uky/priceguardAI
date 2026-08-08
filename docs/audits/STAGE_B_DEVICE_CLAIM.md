# Device Claim Ownership — Threat Model & Migration Strategy
Stage B of docs/audits/REMEDIATION_ROADMAP_PHASE5_13.md — Phase 9.

**Status: PLAN ONLY. No code, schema, or data changed in this stage.**

---

## 1. Full lifecycle (evidence)

```
CREATION
  src/lib/subscription/device-id.ts:getDeviceId()
  → crypto.randomUUID() (122 bits entropy), stored in chrome.storage.local
    key 'priceguard_device_id', generated once per browser profile install.

USAGE (anonymous, pre-signup)
  tracked_products.device_id — legacy rows created before the user ever
  signs in, scoped by this local device_id, user_id = null.

READ / CLAIM (post-signup, once)
  src/lib/supabase/post-login.ts:130-165 → claimDeviceTrackedProducts(deviceId)
    → always called with `await getDeviceId()`, the CALLER'S OWN browser's id.
    → guarded client-side by chrome.storage.local[`claim:{userId}`] === true
      (skips re-calling after first success — not a security control, just
      avoids redundant calls).
  → supabase/functions/claim-device-tracked/index.ts
    → user_id comes from verified JWT (requireAuthUser), NOT from the body.
    → deviceId comes from request body (client-supplied, unauthenticated
      w.r.t. proof of ownership).
    → calls RPC claim_tracked_products_by_device(p_device_id, p_user_id).

DATABASE (SECURITY DEFINER RPC)
  supabase/migrations/20260703120000_device_claim_realtime.sql:41-88
    WHERE device_id = p_device_id AND user_id IS NULL
    → on match: either merge (delete legacy dup if user already tracks that
      product) or claim (set user_id, NULL OUT device_id).
  Access: `revoke all ... from public; grant execute ... to service_role;`
    — cannot be called directly by anon/authenticated, only via the Edge
    Function using the service_role key.

DELETION
  On claim: device_id is set to NULL on the row. A second claim attempt with
  the same device_id then matches ZERO rows (device_id no longer equals
  p_device_id) — the claim is effectively one-shot and self-closing.
```

**Related surface, same trust model, not re-audited in depth this stage:**
`claimTrialRemote(deviceId)` (`src/lib/supabase/client.ts:220`, called from
`src/lib/subscription/index.ts:170`) uses the same "bearer device_id" pattern
for trial-claim. Flagging for awareness; if you want it in scope, it's a
natural Stage B+ follow-up sharing whatever mechanism we pick here.

---

## 2. Threat model

| # | Attacker | Asset | Vector | Impact | Likelihood | Current mitigation |
|---|---|---|---|---|---|---|
| T1 | Anonymous attacker who learns another browser's `device_id` | Victim's **pre-signup** tracked_products (watchlist only — no prices paid, no PII, no payment data) | Call `claim-device-tracked` with victim's `device_id` before the victim ever signs up/logs in | Attacker's own account gains victim's tracked SKUs (an annoyance, not a data breach — no reviews/PII/payment info is reachable this way) | **Very low.** `device_id` is `crypto.randomUUID()` (122 bits) — no brute force. Grepped every client call site: `deviceId` is always sourced from the browser's own `getDeviceId()`, never a user-typed/pasted field anywhere in `src/` — there is no UI surface that would let someone even attempt to submit an arbitrary ID they didn't already have. | JWT-verified `user_id` (can't impersonate another *account*); one-shot claim (row's `device_id` is nulled after use, so even a successful theft can't repeat and can't touch a row that the real owner already claimed). |
| T2 | A user who has already legitimately signed up and claimed their own device | (same asset) | Race their own claim twice, or replay the request | No impact — RPC is idempotent by construction (`WHERE ... user_id IS NULL`); second call matches nothing. | N/A (not exploitable, by design) | RPC WHERE clause |
| T3 | Attacker with **local access** to the victim's actual browser/profile (shared computer, malware, devtools) | Same asset, but also anything else `chrome.storage.local` holds | Read `priceguard_device_id` directly from storage | High **if T3's premise holds**, but this is a local-machine-compromise scenario — device_id theft is the least of the victim's problems at that point (session cookies, other extensions' data, etc. are equally exposed) | Out of scope for this control — no server-side fix addresses a compromised client | N/A |

**Bottom line:** the practical residual risk is lower than the original audit
framing suggested. It's not "any authenticated user can steal any other
user's data" — it's "an attacker who already has a specific unclaimed
device_id, obtained through a channel outside this app's control, can claim
a pre-signup watchlist before the rightful owner does." No PII, reviews, or
payment data is reachable through this path (confirmed: `claim_tracked_products_by_device`
only ever touches `tracked_products`, nothing else).

---

## 3. Options for a stronger ownership proof

| Option | How it would work | Effort | Breaks existing users? | Recommendation |
|---|---|---|---|---|
| **A — Keep as-is** | No change. Rely on entropy + one-shot claim + no UI leak path. | None | No | **My default recommendation**, given T1's likelihood/impact above. Revisit only if a real leak path appears (e.g. device_id ever gets logged, put in a URL, or a future feature adds a "restore on another device" UI that accepts typed input). |
| **B — Claim-at-signup only** | Only allow the claim call within a short window (e.g. 10 min) of first account creation, enforced server-side via `auth.users.created_at`. Removes the "wait indefinitely for a target" attack shape. | Small — one extra check in the Edge Function + RPC | No — legitimate flow already claims immediately post-login | Reasonable middle ground if you want defense-in-depth without a UX change. |
| **C — Signed claim token** | At `getDeviceId()` creation time, also mint a locally-stored HMAC token (server secret) proving "this browser generated this device_id." Claim call must present the token, not just the raw ID. | Medium — new Edge Function or extend existing one to issue tokens, extension code to store/send it, migration to add a `claim_token_hash` column | Existing installs have no token → **would break existing anonymous users' ability to claim** unless we ship a grace period (accept bare device_id for N months, then require token for new installs only) | Only worth it if T1's likelihood assessment changes (e.g., you later find a real exposure path). |

Given the evidence in Section 2, **Option A (no change) is my recommendation**
for now — implementing B or C would be effort spent on a threat that, as
currently understood, has no real path to occur. I'm flagging this explicitly
as **DECISION REQUIRED** from you rather than deciding it myself, since it's
a risk-acceptance call, not a technical one.

---

## 4. If you choose to proceed anyway

Per Phase 9's explicit instruction ("Не ломать существующих пользователей.
Сначала создать migration strategy."), Option B would be the next stage's
scope: a small Edge Function change gated behind a config flag, tested with
the exact scenarios from the roadmap (legitimate claim within window,
claim attempt outside window, claim attempt for an already-claimed device).
Option C would need its own dedicated stage — it's schema + client + rollout
sequencing, not a one-message change.

Nothing has been implemented in this stage. Awaiting your call on Section 3
before writing any code.
