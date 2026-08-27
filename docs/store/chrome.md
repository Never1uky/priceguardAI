# Chrome Web Store — listing draft

**Status:** draft for operators — **do not auto-publish**  
**Version package:** `release/0.9.107/priceguard-ai-v0.9.107.zip`  
**Canonical long-form + §9 hosts:** also `docs/CHROME_WEB_STORE_LISTING.md`

---

## Title

```
PriceGuard AI
```

---

## Short description

**RU (≤132):**

```
AI-анализ отзывов, сравнение цен на маркетплейсах и алерты в Telegram — даже без открытого Chrome.
```

**EN:**

```
AI review insights, cross-store prices & Telegram alerts — even without Chrome open.
```

---

## Full description

**RU:**

```
PriceGuard AI — умный помощник для покупок на популярных маркетплейсах и интернет-магазинах.

Сравнивайте цены между площадками, читайте AI-разбор отзывов и получайте алерты о падении цены в браузере и в Telegram — в том числе когда браузер закрыт (серверный мониторинг).

🛒 ДЛЯ КОГО
• Покупатели на маркетплейсах (WB, Ozon, Я.Маркет и др. по выбору)
• Те, кто ищет, где дешевле, без ручного копирования ссылок
• Те, кто ждёт скидку и не хочет переплачивать
• Те, кому нужен короткий вердикт по отзывам

✨ ВОЗМОЖНОСТИ

🤖 AI-анализ отзывов и полный разбор товара
Плюсы, минусы, риск накрутки, вердикт «покупать / подождать». Free: до 3 AI-анализов в сутки (после входа). Premium — без лимита AI.

⚖️ Сравнение цен
Один товар — таблица офферов по выбранным площадкам (по умолчанию WB / Ozon / Яндекс.Маркет). Дополнительные магазины включаются в настройках.

📉 Отслеживание и история цен
Список «Отслеживаемое», целевая цена, история. Free: до 5 товаров; Premium: до 50.

🔔 Алерты в браузере и Telegram
@PriceGuardAlertsBot — падение цены и AI по ссылке. Поддержка: @priceguard_supportbot.

☁️ Без открытого браузера
При Telegram сервер проверяет цены по расписанию.

🛍️ ПЛОЩАДКИ
По умолчанию: wildberries.ru · ozon.ru · market.yandex.ru
Опционально: Мегамаркет, AliExpress, М.Видео/Эльдорадо, DNS, Ситилинк, Lamoda

Не аффилированы с маркетплейсами. Данные — с публичных страниц. Политика конфиденциальности на сайте продукта.
```

**EN:** use `docs/CHROME_WEB_STORE_LISTING.md` §2 EN (fix Premium tracking to **up to 50**, not “unlimited”).

---

## Category

**Shopping** (or closest CWS equivalent)

Language: **Russian** primary, English optional.

---

## Permissions explanation

Paste CWS dashboard justifications from `docs/CHROME_WEB_STORE_LISTING.md` **§9** for:

- `storage`, `scripting`, `notifications`, `alarms`, `webNavigation`
- Each host family (WB APIs, Ozon, YM, opt-in MPs, Supabase)
- `externally_connectable` → priceguard-seo.vercel.app

**Single purpose:** `docs/STORE_PRIVACY_DISCLOSURE.md` COMMON / CWS §8.

---

## Privacy explanation

**Privacy Policy URL:** https://priceguard-landing.vercel.app/privacy (v2.5)

**Data use (short):** see `docs/STORE_PRIVACY_DISCLOSURE.md` COMMON EN block.  
Processors: Supabase, AI providers, Scrappey (server, core MPs), YooKassa, Telegram. We do not sell personal data.

---

## Screenshots requirements

| Asset | Spec |
|-------|------|
| Screenshots | Prefer **1280×800** (or current CWS minimum); ≥1, typically 5 |
| Subjects | Compare table; AI reviews; track list; Telegram; settings / multi-MP |
| Source | `docs/store-assets/` |
| Store icon | 128×128 (`docs/store-assets/icons/store-icon-128.png`) |
| Optional promo | small 440×280, marquee 1400×560 if Featured |

---

## Support URL

- Email: `mailto:priceguardAlsupp0rt@yandex.ru` or listed as support email  
- Telegram: https://t.me/priceguard_supportbot  

---

## Website URL

https://priceguard-landing.vercel.app  

SEO hub (optional secondary): https://priceguard-seo.vercel.app  

---

## Install URL

https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf  

---

## Review URL

https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf/reviews  

---

## Notes for moderation

- MV3; no remote code execution; AI via our Supabase Edge proxy.  
- Host permissions include **opt-in** stores; Scrappey server scrape is for **WB/Ozon/YM** monitoring/Premium paths only (see Privacy §2.6).  
- Free 5 tracked / Premium 50; Free AI 3/day.  
- Upload zip from `release/0.9.107/` only; verify SHA256.  
- Unlisted → Public only after smoke (`docs/MULTI_STORE_QA.md`).  
- **Do not auto-publish** from CI/agents.
