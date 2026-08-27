# Privacy Policy — PriceGuard AI

**Effective date:** 24 July 2026
**Version:** 2.4
**Privacy contact:** priceguardAlsupp0rt@yandex.ru  
**Support Telegram:** @priceguard_supportbot  

Published page: https://priceguard-landing.vercel.app/privacy  

---

## 1. Overview

This Policy explains how **PriceGuard AI** (Chrome extension, website, Edge backends, Telegram bots) processes data.

Operator: **Kulikov Maxim Vladimirovich** (self-employed, INN 504213122300, Russia).

By using the product you agree to this Policy. If you do not agree, do not install the extension or connect Telegram.

PriceGuard AI helps compare prices on Wildberries, Ozon and Yandex Market, run AI review analysis, track prices, and send alerts (browser and Telegram), including AI analysis from a product link in the alerts bot.

---

## 2. Data we process

### 2.1 Product and price data

Titles, SKUs, product URLs, prices/discounts, cross-marketplace comparisons, watchlists, target prices, alert thresholds, price history (local and, when signed in with monitoring, cloud `product_price_history` while the account/watchlist is active).

**Where:** primarily `chrome.storage.local`; with an account — also Supabase (`tracked_products`, and `product_price_history` when server monitoring is on). Untracking a product may leave a soft-deleted tombstone on the server until account deletion.

Shared, non-personal matching data (product IDs/URLs, confidence) may be stored in cross-marketplace mapping tables to improve comparisons.

### 2.2 Reviews and AI analysis

When you run AI analysis (extension or Telegram alerts bot), we may send to AI providers via our Edge proxy:

- review texts (up to a limited sample per request);
- short product fields (title, article/SKU, marketplace, current/old price);
- price history snippets when available;
- comparison offer titles, ratings and prices;
- for Telegram “ask AI”: your question, recent Q&A in the thread, and cached analysis context.

Raw review text may also be stored temporarily in a shared product/review cache for reuse. Results may be stored in shared `product_cache` (about 7-day freshness; expired rows are purged periodically) keyed by marketplace + product id (not by your email). AI API keys are never stored in the extension.

### 2.3 Account (optional)

Via Supabase Auth: email, user UUID, session tokens (local). We do not store plaintext passwords.

### 2.4 device_id and license

Random UUID for AI rate limits, license binding, and telemetry. Not linked to identity until you sign in.

If you activate Premium, the **license key** may be stored locally in the extension until deactivated or the extension is uninstalled.

### 2.5 Telegram (optional)

If you provide a Chat ID: delivery of price alerts; product session for AI card buttons; AI chat threads (~48h, then purged); support messages forwarded to the operator (may include Telegram username / first and last name from Telegram). Bots: **@PriceGuardAlertsBot**, **@priceguard_supportbot**. Chat ID is not sold.

**To stop Telegram processing:** turn off / disconnect Telegram in the extension **Settings** (requires account sign-in so the Chat ID is cleared on the server). Deleting the bot chat alone does **not** remove the stored Chat ID or stop server monitoring.

### 2.6 Server scrape (Scrappey)

Our servers may fetch product pages/data via **Scrappey** (product URL in, HTML/content out) for antibot marketplaces when:

- Telegram **server price monitoring** is enabled; and/or
- a signed-in user triggers server-assisted card/offer unlock or compare research.

Your browser cookies are **not** sent to Scrappey. Short price results may be cached (~6 hours; expired rows purged periodically). Unused legacy scraper credential columns may exist in settings storage and are not used by current code.

### 2.7 Telemetry, matching feedback, and support diagnostics

When signed in we may process:

- **AI request logs** (provider, success, duration — not full prompts);
- **authenticity events** and extension version;
- **match feedback** (accepted/rejected compare candidates: marketplace product IDs/URLs and confidence) to improve shared cross-marketplace mappings;
- **compare research** requests (product title and source URL for server-side SERP assist).

Search success/latency summaries may be sent to `search_metrics` (truncated query, marketplace, success, timing — not full browsing history). Detailed WARN/ERROR event batches are stored **on-device** by default. Upload to `telemetry_events` is **opt-in** and available only in the developer diagnostics UI (not shown to regular users). Events may include `device_id` / account `user_id`, stage names, error codes, hashed queries, and redacted metadata — never AI prompt text or emails.

**Automatic support error reports** (no confirm dialog): on unexpected extension errors the client may call Edge `support-notify` with: error text (up to **800** characters), optional context (up to **200**), extension **version**, and signed-in **userId** (if any). Expected UX/auth messages are filtered client-side; reports are rate-limited. Forwarded to the operator via Telegram.

No full browsing history or card PANs.

### 2.8 Premium payments (YooKassa)

Processed by **YooKassa**. We do **not** store card numbers. For checkout we may send and store: plan, amount, payment status, session id, **account email**, and **user UUID** (including as YooKassa metadata / receipt customer). After payment we store license binding data. Payment rows may retain email even if the auth user is later deleted (user id nullified); scrubbing on deletion request is described in our operator runbook.

### 2.9 Optional affiliate URL parameters

Technical partner query params may be appended to product links from local settings. No separate sale of personal data for ads.

### 2.10 Website and cookies

The marketing site may use technical browser storage for navigation/payment return URLs. Extension: `chrome.storage` (settings, price history, cache). The extension does **not** use the `cookies` permission and does not read or export browser cookie values to PriceGuard servers or AI providers. Marketplace page requests in the browser may use the site’s own session cookies locally (same as normal browsing); those cookies are not forwarded to Scrappey or AI.

No marketing email without consent.

---

## 3. Purposes

Provide extension and bot features; AI analysis and caching; alerts and comparison; Premium billing; support and security; improve search/AI quality via telemetry.

---

## 4. Storage and processors

| Category | Where / who |
|----------|-------------|
| Local settings & history | Your browser |
| Account, sync, cache, logs | Supabase |
| AI requests | xAI (Grok), OpenAI, Perplexity (incl. via AITunnel) |
| Server scrape | Scrappey (page URL) |
| Payments | YooKassa (email, user id metadata, amount/plan — no PAN) |
| Bot messages | Telegram |
| Website | Hosting (e.g. Vercel) |

---

## 5. Retention

Account/license while active (+ reasonable period after); local data until uninstall/clear; cloud price history while the account/watchlist is active.

Periodic cleanup (when enabled): `product_cache` older than ~7 days; `price_scrape_cache` older than ~6 hours; expired `telegram_ai_threads` (~48 hours); `ai_request_log` / `search_metrics` older than ~90 days. Freshness checks also ignore stale cache without waiting for purge.

Service logs may be retained for operations and security and are removed on account-deletion request and/or by the periodic cleanup above.

---

## 6. Your rights and deletion

You may request access, correction, restriction or deletion of account-related data.

Email priceguardAlsupp0rt@yandex.ru with subject “Data deletion” and your account email. Local data is removed with the extension (uninstall). Sign-out alone does not wipe watchlist or caches.

To stop Telegram: disconnect in **Settings** (signed in). Shared product caches and matching tables are not personal account data. After Auth user deletion, some records may remain with null `user_id` (e.g. metrics device_id, payment email until scrubbed per request).

---

## 7. Security

HTTPS; secrets server-side only; access controls.

---

## 8. Children

Not intended for users under 18.

---

## 9. Changes

The current version is published on the website and in the docs repository.

---

## 10. Contact

priceguardAlsupp0rt@yandex.ru · @priceguard_supportbot · https://priceguard-landing.vercel.app/privacy  
