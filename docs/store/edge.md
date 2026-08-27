# Microsoft Edge Add-ons — listing draft

**Status:** draft — **do not auto-publish**  
**Package:** same as CWS — `release/0.9.107/priceguard-ai-v0.9.107.zip`  
**Guide:** `docs/EDGE_RELEASE.md` · `release/0.9.107/EDGE_UPLOAD.md`

---

## Title

```
PriceGuard AI
```

---

## Short description

**RU:**

```
AI-анализ отзывов, сравнение цен на маркетплейсах и алерты в Telegram — даже когда браузер закрыт.
```

**EN:**

```
AI review insights, cross-store prices & Telegram alerts — even when the browser is closed.
```

*(Avoid “Chrome” in Edge short description where possible.)*

---

## Full description

**RU:**

```
PriceGuard AI — браузерное расширение для покупок на маркетплейсах.

Сравнение цен (по умолчанию Wildberries, Ozon, Яндекс.Маркет; другие магазины — в настройках), AI-разбор отзывов и уведомления о падении цены в браузере и в Telegram — в том числе при закрытом Edge (серверный мониторинг).

Возможности:
• AI: плюсы, минусы, риск накрутки, вердикт
• Таблица «где дешевле» по выбранным площадкам
• Отслеживание и история цен (Free до 5, Premium до 50 товаров)
• Алерты: браузер + @PriceGuardAlertsBot
• Поддержка: @priceguard_supportbot

Опциональные площадки: Мегамаркет, AliExpress, М.Видео/Эльдорадо, DNS, Ситилинк, Lamoda (включаются вручную).

Не аффилированы с маркетплейсами. Политика конфиденциальности: https://priceguard-landing.vercel.app/privacy

Тот же продукт, что в Chrome Web Store; один MV3-пакет.
```

**EN:** mirror RU; mention Chromium Edge; Free/Premium limits 5 / 50 tracked.

---

## Category

**Shopping** / Productivity–Shopping (use Partner Center closest match)

---

## Permissions explanation

Same as Chrome — copy from `docs/CHROME_WEB_STORE_LISTING.md` §9:

| Permission | One-line |
|------------|----------|
| storage | Tracks, settings, auth session, local caches |
| scripting | Read public product/SERP data on declared hosts |
| notifications | Price-drop browser alerts |
| alarms | Periodic checks / background tasks |
| webNavigation | SPA navigation on marketplace product pages |

Plus **each host** row (WB, Ozon, YM, opt-in MPs, Supabase).  
**Reviewer note:** APIs use the `chrome.*` namespace (supported on Chromium Edge). No `browser.*` polyfill.

---

## Privacy explanation

**URL:** https://priceguard-landing.vercel.app/privacy  

Paste `docs/STORE_PRIVACY_DISCLOSURE.md` COMMON data-use block.  
Same processors as CWS. Opt-in hosts ≠ Scrappey monitoring.

---

## Screenshots requirements

| Asset | Spec |
|-------|------|
| Screenshots | Follow **current** Edge Add-ons size rules in Partner Center (often similar to 1280×800 — verify form) |
| Count | Meet minimum required by the form |
| Content | Same subjects as CWS (`docs/store-assets/`) — Edge window chrome optional |
| Icon | 128×128 store icon |

Do not invent new permission screenshots that imply undeclared hosts.

---

## Support URL

- https://t.me/priceguard_supportbot  
- Email: priceguardAlsupp0rt@yandex.ru  

---

## Website URL

https://priceguard-landing.vercel.app  

---

## Install URL

**TBD after first publish** — leave blank in forms until Partner Center assigns the listing.  
Then set `STORE_CONFIG.edge.storeUrl` and SEO/landing store URLs.  
Until then, public install CTA may still point at CWS.

Placeholder (do not invent): `https://microsoftedge.microsoft.com/addons/detail/...`

---

## Review URL

**TBD** with listing (usually listing URL + reviews section).  
`STORE_CONFIG.edge.reviewUrl` stays `null` until known.

---

## Notes for moderation

- **Identical zip** to Chrome Web Store 0.9.107 — verify SHA256 in `release/0.9.107/SHA256.txt`.  
- Prefer CWS update of this version before Edge Public (Option B).  
- No `update_url` in manifest (store updates).  
- After approval: record **extension ID** for SEO `extensionIds` allowlist (Phase 4).  
- **Do not auto-publish.**
