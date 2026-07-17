# Privacy Policy — PriceGuard AI

**Effective date:** 17 July 2026  
**Version:** 2.0  
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

Titles, SKUs, product URLs, prices/discounts, cross-marketplace comparisons, watchlists, target prices, alert thresholds.

**Where:** primarily `chrome.storage.local`; with an account — also Supabase (`tracked_products`, and `product_price_history` when server monitoring is on).

### 2.2 Reviews and AI analysis

When you run AI analysis (extension or Telegram alerts bot), review texts and short product fields are sent via our Edge proxy to AI providers. Results may be stored in a shared `product_cache` (~7-day TTL) keyed by marketplace + product id (not by your email). AI API keys are never stored in the extension.

### 2.3 Account (optional)

Via Supabase Auth: email, user UUID, session tokens (local). We do not store plaintext passwords.

### 2.4 device_id

Random UUID for AI rate limits, license binding, anonymous telemetry. Not linked to identity until you sign in.

### 2.5 Telegram (optional)

If you provide a Chat ID: delivery of price alerts; product session for AI card buttons; AI chat threads (~48h TTL); support messages forwarded to the operator. Bots: **@PriceGuardAlertsBot**, **@priceguard_supportbot**. Chat ID is not sold.

### 2.6 Server price monitoring (Bright Data)

With Telegram server monitoring enabled, our servers fetch product pages/data. For antibot marketplaces we may use **Bright Data Web Unlocker** (product URL in, HTML/content out). Your browser cookies are **not** sent to Bright Data. Short price results may be cached (~2 hours).

### 2.7 Telemetry

Anonymous search metrics, AI request logs (provider, success, duration), authenticity events, extension version. No full browsing history or card PANs.

### 2.8 Premium payments

Processed by **YooKassa**. We receive payment status and license binding data only.

### 2.9 Optional affiliate URL parameters

Technical partner query params may be appended to product links from local settings. No separate sale of personal data for ads.

### 2.10 Website

Technical cookies/localStorage for payment/session pages. No marketing email without consent.

---

## 3. Purposes

Provide extension and bot features; AI analysis and caching; alerts and comparison; Premium billing; support and security; improve search/AI quality via aggregated telemetry.

---

## 4. Storage and processors

| Category | Where / who |
|----------|-------------|
| Local settings & history | Your browser |
| Account, sync, cache, logs | Supabase |
| AI requests | xAI (Grok), OpenAI, Perplexity (incl. via AITunnel) |
| Server scrape | Bright Data (page URL) |
| Payments | YooKassa |
| Bot messages | Telegram |
| Website | Hosting (e.g. Vercel) |

---

## 5. Retention

Account/license while active (+ reasonable period after); local data until uninstall/clear; product_cache ~7 days; scrape cache ~2 hours; Telegram AI threads ~48 hours; service logs typically up to 90 days unless security requires longer.

---

## 6. Your rights and deletion

You may request access, correction, restriction or deletion of account-related data.

Email priceguardAlsupp0rt@yandex.ru with subject “Data deletion” and your account email. Local data is removed with the extension. To stop Telegram: disconnect in Settings and/or delete the bot chat.

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
