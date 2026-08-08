# YooKassa Webhook — Remediation Plan

Status: PLANNED — not yet implemented at time of writing this file.

## Confirmed flow (evidence-based)

```
create-payment (JWT required)
  → insert payments{session_id, plan, amount_rub, status:pending, user_id}
  → POST api.yookassa.ru/v3/payments (Basic shopId:secretKey)
  → real YooKassa payment.id stored as payments.yookassa_payment_id
  → return paymentUrl to client

yookassa-webhook (PUBLIC, NO AUTH)
  → reads event + object.metadata.session_id / object.id from REQUEST BODY
  → looks up payments row by session_id/yookassa_payment_id
  → if event === 'payment.succeeded': issues license_keys row, marks payments.succeeded,
    binds user_premium — ALL based on the untrusted request body, no call back to
    YooKassa to confirm anything.
```

## Answers to the 10 questions

See chat message immediately preceding this file for full evidence citations.
Summary:

| # | Question | Answer |
|---|---|---|
| 1 | Webhook auth by YooKassa | None implemented (no signature scheme exists on YooKassa side by default; IP-allowlist or API callback recommended, neither present) |
| 2 | HTTP Basic auth | Used outbound in create-payment; NOT used in webhook |
| 3 | API verification via YooKassa | Not implemented |
| 4 | Can fetch payment by ID | Yes, `GET /v3/payments/{id}`, same Basic auth already available |
| 5 | Expected amount storage | `payments.amount_rub`, server-set from `PLAN_PRICES`, never compared in webhook |
| 6 | Expected currency storage | Not stored as a column; implicit `'RUB'` in create-payment; never compared in webhook |
| 7 | User determination | From own DB row (`payments.user_id`), not from webhook body — correct already |
| 8 | Idempotency | Partial — protects against replay of the same already-succeeded row, not against first forgery |
| 9 | One payment_id → many licenses | Single payment_id: no (protected). Many session_ids by same user: yes, unlimited, no rate limit found |
| 10 | Manual webhook invocation | Yes, fully public unauthenticated POST |

## Target security model

```
UNTRUSTED WEBHOOK (event, object.id, object.metadata.session_id)
  ↓
1. Basic input validation (method, JSON shape)
  ↓
2. Look up local `payments` row by session_id (own DB — trusted)
  ↓
3. Call YooKassa API: GET /v3/payments/{yookassa_payment_id from OUR row, not from body}
   with Basic auth (shopId:secretKey) — this is the actual source of truth
  ↓
4. Compare API response:
     status === 'succeeded'
     amount.value === payments.amount_rub (string-safe compare)
     amount.currency === 'RUB'
  ↓
5. Idempotency: if payments.status already 'succeeded' && license_key_id set → return
   existing license, do not re-issue (existing logic, kept)
  ↓
6. Only then: create license_keys row, mark payments.succeeded, bind user_premium
```

Key design decision: **the webhook body is used only to look up WHICH local payment
to re-check — never to decide success, amount, or currency.** The real payment_id
used for the verification call comes from `payments.yookassa_payment_id` (our own
DB, populated during create-payment from YooKassa's real response), not from
`object.id` in the incoming webhook body — this prevents an attacker from pointing
the verification at an arbitrary payment_id.

## Files to change

- **New:** `supabase/functions/_shared/yookassa-verify.ts` — pure function
  `verifyYookassaPayment(paymentId, creds, fetchImpl?)`, unit-testable with injected
  fetch mock (same pattern as existing `_shared/cron-auth.ts` + `.test.ts`).
- **Modify:** `supabase/functions/yookassa-webhook/index.ts` — call the new verify
  function instead of trusting `event`/`object` directly.
- **New:** `supabase/functions/_shared/yookassa-verify.test.ts`
- **New:** `supabase/functions/yookassa-webhook/index.test.ts` (handler-level tests
  with mocked Supabase client + mocked fetch)
- **Config (prerequisite, separately flagged):** `vitest.config.ts` — widen `include`
  to also pick up `supabase/functions/**/*.test.ts`, since none of the existing
  Edge Function tests currently run under `npm test`.

## Explicitly NOT in scope for this change

- No new user-facing features.
- No change to `create-payment` flow itself (already correct: server-side amount,
  real YooKassa API call).
- No change to `payments`/`license_keys` schema.
- No secret rotation, no Privacy Policy change, no deploy.

## Test scenarios required

1. `forged webhook` — webhook body claims succeeded, YooKassa API mock returns
   `status: 'pending'` → reject, no license issued.
2. `invalid payment` — YooKassa API mock returns 404 → reject, no license issued.
3. `pending payment` — API returns `status: 'pending'` → reject.
4. `wrong amount` — API returns `status: 'succeeded'` but `amount.value` mismatches
   `payments.amount_rub` → reject, log discrepancy.
5. `wrong currency` — API returns non-RUB → reject.
6. `wrong user` — N/A as an attack (user comes from own DB row) — test instead that
   webhook body cannot override `user_id`.
7. `repeated webhook` — same event sent twice for an already-succeeded row → second
   call returns existing license, does not create a second `license_keys` row.
8. `legitimate webhook` — API confirms succeeded + matching amount/currency →
   license issued, `user_premium` bound.
