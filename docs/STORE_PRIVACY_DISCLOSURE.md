# Store privacy disclosure drafts (Chrome / Edge / Yandex)

Canonical facts: `docs/audits/PHASE11_PRIVACY_DISCLOSURE.md`  
Public policy: https://priceguard-landing.vercel.app/privacy (v2.5)

Copy-paste blocks for Partner Center / CWS / future Yandex forms.

---

## COMMON (all stores)

**Privacy policy URL**  
https://priceguard-landing.vercel.app/privacy

**Single purpose (RU)**  
Помогает сравнивать цены на популярных маркетплейсах и интернет-магазинах, анализировать отзывы с помощью AI и получать уведомления о падении цены (браузер и Telegram). По умолчанию — Wildberries, Ozon и Яндекс.Маркет; дополнительные площадки включаются в настройках.

**Single purpose (EN)**  
Helps compare prices on popular marketplaces and online stores, analyze reviews with AI, and get price-drop alerts (browser and Telegram). Defaults: Wildberries, Ozon, and Yandex Market; extra stores are opt-in in settings.

**Data use (EN short)**  
Reads public product/search pages on declared host permissions (default WB/Ozon/YM; optional Megamarket, AliExpress, M.Video/Eldorado, DNS, Citilink, Lamoda when enabled by the user). May send product URLs, prices, review samples, and account-linked sync data to our Supabase backend for AI, sync, and alerts. Optional Telegram chat id for alerts. Server-side Scrappey may fetch core-marketplace product URLs (no browser cookies). Payments via YooKassa (no card data stored in the extension). We do not sell personal data. Processors: Supabase, AI providers, Scrappey, YooKassa, Telegram.

---

## CHROME

Use `docs/CHROME_WEB_STORE_LISTING.md` §8–§9 in full for permission and **each host** justification (including opt-in MPs).

---

## EDGE

Paste COMMON blocks above.  
Permission justifications: same table as CWS §9 (`storage`, `scripting`, `notifications`, `alarms`, `webNavigation` + each host family).

**Note for reviewers:** Same package as Chrome Web Store; Microsoft Edge Chromium APIs via `chrome.*` namespace.

---

## YANDEX

If installing via Chrome Web Store inside Yandex Browser: **no extra form** — CWS disclosure applies.

If a Yandex catalog form appears: paste COMMON + CWS §9 host table; state that optional stores are user opt-in and excluded from Scrappey monitoring.
