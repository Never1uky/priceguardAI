# Phase 11 — Privacy / disclosure alignment

**Privacy URL (all stores):** https://priceguard-landing.vercel.app/privacy  
**Policy version:** 2.5 (`docs/PRIVACY_POLICY_RU.md` / landing HTML)  
**Manifest hosts:** core trio + opt-in MPs + Supabase (see Phase 10)

**Verdict:** Policy §2.6 and CWS §9 already describe opt-in marketplace hosts. No contradiction that blocks Edge/Yandex submit. Minor ops drift: CWS checklist still cites policy **v2.4** in one place — use **2.5** in forms.

No separate privacy policy per store — one URL everywhere.

---

## COMMON PRIVACY FACTS

Use the same facts in every store questionnaire.

### Product purpose

Helps users compare prices on marketplaces, analyze public reviews with AI, track products, and receive price-drop alerts in the browser and optional Telegram — including when the browser is closed (server monitoring).

### Default vs opt-in stores

| Tier | Stores | How data is read |
|------|--------|------------------|
| **Default** | Wildberries, Ozon, Yandex Market | Content scripts / tabs; server Scrappey only for eligible Premium / Telegram monitoring on these MPs |
| **Opt-in** («Где искать») | Megamarket, AliExpress, M.Video/Eldorado, DNS, Citilink, Lamoda | Local/public page read only when user enables the store (or opens its tab). **No** Scrappey Telegram monitoring for these |

### Permissions (manifest)

`storage`, `notifications`, `alarms`, `scripting`, `webNavigation` — same justifications as CWS §9.

### Host access (manifest)

- Named marketplace HTTPS hosts listed in `manifest.json`  
- `https://ihlfvpocwobvcpxbypsd.supabase.co/*` for Auth, sync, AI proxy, licenses, alerts  
- SEO bridge: `externally_connectable` → `https://priceguard-seo.vercel.app/*` (production zip; no localhost)

### Data categories

| Category | Where |
|----------|--------|
| Product URLs, titles, prices, track list, alert thresholds | Local `chrome.storage`; cloud if signed in |
| Review text sample → AI | Via Supabase Edge → AI providers; optional `product_cache` |
| Email / user UUID | Optional Supabase Auth |
| `device_id` | Local; limits / license / telemetry |
| Telegram chat id, alert delivery | Optional; bots @PriceGuardAlertsBot / @priceguard_supportbot |
| Scrappey | Server-side URL scrape for core MPs only (Premium unlocker / monitoring) — **no browser cookies** |
| Payments | YooKassa; no card numbers in extension |
| Telemetry | Local ring default; remote WARN/ERROR **opt-in** (developer diagnostics); truncated auto support errors |

### Processors

Supabase, AI providers (via Edge), Scrappey (server), YooKassa, Telegram — service operation only. **We do not sell personal data.**

### Not collected

Full browsing history; payment card numbers; AI API keys in the extension; marketplace cookies sent to PriceGuard/Scrappey.

### Contact

`priceguardAlsupp0rt@yandex.ru` · `@priceguard_supportbot`

---

## CHROME DISCLOSURE

**Store:** Chrome Web Store  
**Listing source:** `docs/CHROME_WEB_STORE_LISTING.md`  
**Privacy URL:** https://priceguard-landing.vercel.app/privacy  

### Single purpose (draft — already in §8)

RU: Помогает сравнивать цены на популярных маркетплейсах и интернет-магазинах, анализировать отзывы с помощью AI и получать уведомления о падении цены (браузер и Telegram). По умолчанию — Wildberries, Ozon и Яндекс.Маркет; дополнительные площадки включаются в настройках.

### Remote code / data use (draft)

The extension reads public product/search pages on hosts listed in host_permissions (defaults WB/Ozon/YM; optional Megamarket, AliExpress, M.Video/Eldorado, DNS, Citilink, Lamoda when enabled). Product and review data may be sent to our Supabase backend for AI analysis, sync, and alerts. Automatic truncated error reports may go to operators. Processors: Supabase, AI providers, Scrappey (server page fetch for core marketplaces), YooKassa, Telegram. We do not sell personal data. Full policy: privacy URL above.

### Host justifications

Copy table from `docs/CHROME_WEB_STORE_LISTING.md` §9 (includes all opt-in MP hosts).

### Operator note

Update any remaining “policy v2.4” checklist lines to **2.5** when editing the listing.

---

## EDGE DISCLOSURE

**Store:** Microsoft Edge Add-ons  
**Artifact:** same zip as CWS  
**Privacy URL:** same  

Edge form fields differ; paste equivalents of COMMON FACTS + permission/host rows from CWS §9.

### Single purpose (draft)

Same RU/EN as Chrome §8. Optional soften “Chrome” → “browser” in long description if the form has a free-text field:

> PriceGuard AI is a browser extension for Wildberries, Ozon, Yandex Market (and optional extra stores)…

### Why host permissions (short draft for Edge)

We access only the listed shopping sites so the extension can read public product prices, titles, and reviews for comparison and tracking when you visit those sites or enable them in settings. We access our Supabase API host for account sync, AI, licenses, and alerts. Optional marketplaces are not used for server-side Scrappey monitoring.

### Data collected (Edge checkbox style — draft)

- Website content (product pages on declared hosts)  
- Personally identifiable information: email if you sign in; Telegram chat id if you connect alerts  
- Financial: handled by YooKassa (no card data in extension)  
- Product activity: tracked items, prices, compare results  

Deny: browsing history beyond declared hosts; personal communications unrelated to support/Telegram bots you connect.

### After Edge ID exists

Install/review links may point to Edge listing (Phase 5); privacy URL stays the same.

---

## YANDEX DISCLOSURE

**Distribution:** primarily install from **Chrome Web Store inside Yandex Browser** (see `docs/YANDEX_RELEASE.md`). Separate Yandex catalog upload may not apply.

**Privacy URL:** same  
**Disclosure:** same COMMON FACTS as CWS (same binary + same hosts).

### If only CWS-in-Yandex

No separate Yandex store form — CWS disclosure covers users. Mention in support FAQ:

> В Яндекс Браузере установите PriceGuard из Chrome Web Store («Добавить в Яндекс Браузер»). Политика конфиденциальности: https://priceguard-landing.vercel.app/privacy

### If a Yandex partner catalog form appears later

Reuse Edge/Chrome drafts; emphasize:

- Opt-in extra stores (Megamarket, AliExpress, M.Video/Eldorado, DNS, Citilink, Lamoda)  
- Scrappey only for WB/Ozon/YM server paths  
- Same processors and privacy URL  

Do **not** invent a different privacy policy.

### Single purpose (draft, Yandex-facing)

RU: Расширение для сравнения цен и AI-анализа отзывов на маркетплейсах (по умолчанию Wildberries, Ozon, Яндекс.Маркет; другие магазины — по выбору в настройках) и уведомлений о снижении цены в браузере и Telegram.

---

## Consistency matrix

| Claim | Manifest | Policy 2.5 | CWS listing | Edge/Yandex |
|-------|----------|------------|-------------|-------------|
| Core trio default | hosts + CS | §1, §2.6 | §8, store list | same facts |
| Opt-in extra MPs | hosts present | §2.6 explicit | §9 host rows | same |
| Scrappey core only | N/A (server) | §2.6 | Data use / Scrappey | same |
| No cookies permission | no `cookies` | §2.10 | §9 “не запрашиваем cookies” | same |
| Privacy URL | — | live | required | same URL |
| Separate Edge/Yandex policy | — | **No** | — | use common URL |

---

## Gaps / follow-ups (non-blocking)

1. CWS doc checklist “Policy v2.4” → update to 2.5 when touching listing.  
2. Policy intro still says «Chrome-расширение» — accurate for CWS; optional later wording «браузерное расширение (Chrome / Edge / Яндекс.Браузер)» — **not required** for Edge submit if privacy URL already covers processors.  
3. After Edge listing URL exists, add to `STORE_CONFIG.edge` (Phase 3/5) — disclosure text unchanged.

---

## Explicit non-actions this phase

- No privacy policy rewrite  
- No new permissions  
- No separate `PRIVACY_EDGE.md` product policy — only this disclosure pack
