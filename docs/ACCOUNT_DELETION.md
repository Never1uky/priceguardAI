# Account deletion runbook — PriceGuard AI

Operator checklist when a user emails **priceguardAlsupp0rt@yandex.ru** with subject «Удаление данных» / “Data deletion” and their account email.

Privacy Policy: https://priceguard-landing.vercel.app/privacy  
Project ref: `ihlfvpocwobvcpxbypsd`

## 1. Verify requester

- Confirm the email matches `auth.users.email` (or ask for proof if ambiguous).
- Note Telegram Chat ID if they mention it (for session cleanup).

## 2. Disable Telegram first (if still linked)

In SQL Editor (service role / Dashboard):

```sql
update public.user_alert_settings
set telegram_chat_id = '',
    telegram_enabled = false,
    updated_at = now()
where user_id = '<USER_UUID>';
```

Optional by chat id:

```sql
delete from public.telegram_product_sessions where chat_id = '<CHAT_ID>';
delete from public.telegram_ai_threads where chat_id = '<CHAT_ID>';
```

## 3. Delete Auth user

Dashboard → Authentication → Users → delete user, **or**:

```sql
-- via Auth Admin API / Dashboard preferred
-- cascades: user_alert_settings, user_premium, tracked_products (user-owned), product_price_history
-- sets null: payments.user_id, license_activations.user_id, search_metrics.user_id, ai_request_log.user_id, telegram_product_sessions.user_id
```

## 4. Scrub payment PII (email)

```sql
update public.payments
set customer_email = null
where user_id is null
  and customer_email = '<USER_EMAIL>';
-- also match by known user_id before step 3 if preferred
```

Keep payment rows for accounting if required; strip email/PII.

## 5. Licenses (optional)

If the user asks to revoke Premium / license keys tied only to them:

```sql
-- inspect then deactivate
select id, key_code, plan, is_active from public.license_keys
where id in (
  select license_key_id from public.user_premium where user_id = '<USER_UUID>'
);
-- after auth delete, find via payments.license_key_id / notes
```

Do **not** delete shared demo keys.

## 6. Shared caches (usually leave)

`product_cache`, `price_scrape_cache`, `cross_market_mapping`, `match_feedback` are not keyed by user email. No action unless a legal request requires wiping a specific product id.

Periodic purge: `select public.purge_privacy_ttl_data();` (cron `priceguard-privacy-ttl-purge`).

## 7. Tell the user

- Cloud account data removed / Telegram cleared.
- They should uninstall the extension (or clear site data) to wipe local `chrome.storage` (watchlist, license key, caches).
- Sign-out alone does not wipe local storage.

## 8. Log

Record date, email, actions taken (internal only).
