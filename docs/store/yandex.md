# Yandex Browser — listing / distribution draft

**Status:** draft — **do not auto-publish**  
**Package:** same zip `release/0.9.107/priceguard-ai-v0.9.107.zip`  
**Guide:** `docs/YANDEX_RELEASE.md` · `release/0.9.107/YANDEX_UPLOAD.md`

---

## Distribution model (read first)

Яндекс.Браузер обычно ставит сторонние расширения из **Chrome Web Store** (или Opera), а не через отдельный Edge-подобный Partner Center.

| Path | What to fill |
|------|----------------|
| **A. Primary today** | Users install via **CWS listing** inside Yandex → use `docs/store/chrome.md` for store text; this file = support/FAQ + QA notes |
| **B. If Yandex catalog form appears** | Reuse sections below as paste targets; still **one zip** |

Compatibility is **not** certified without `docs/MULTI_STORE_QA.md` on a real Yandex build.

---

## Title

```
PriceGuard AI
```

---

## Short description

**RU:**

```
AI-анализ отзывов, сравнение цен на маркетплейсах и алерты в Telegram.
```

**EN:**

```
AI reviews, cross-marketplace prices, and Telegram price alerts.
```

---

## Full description

**RU (for FAQ / future catalog):**

```
PriceGuard AI — расширение для Яндекс Браузера (Chromium) и других браузеров на базе Chromium.

Установка сейчас: откройте страницу расширения в Chrome Web Store и нажмите «Добавить в Яндекс Браузер».

Что умеет:
• Сравнение цен (по умолчанию Wildberries, Ozon, Яндекс.Маркет; другие — в настройках)
• AI-анализ отзывов
• Отслеживание цен и алерты в браузере и Telegram (@PriceGuardAlertsBot)
• Серверный мониторинг при подключённом Telegram (браузер может быть закрыт)

Free: до 5 товаров, до 3 AI/сутки. Premium: до 50 товаров, без лимита AI.

Политика: https://priceguard-landing.vercel.app/privacy
Поддержка: @priceguard_supportbot · priceguardAlsupp0rt@yandex.ru
```

---

## Category

Shopping / Покупки (if a Yandex form offers categories — match closest)

---

## Permissions explanation

Identical to Chrome (`docs/CHROME_WEB_STORE_LISTING.md` §9).  
If a Yandex form asks “why these sites”: public product/search pages for compare & tracking; Supabase for account/AI/alerts; optional stores only when user enables them.

---

## Privacy explanation

**URL:** https://priceguard-landing.vercel.app/privacy  

Same COMMON disclosure as Chrome/Edge (`docs/STORE_PRIVACY_DISCLOSURE.md`).  
No separate Yandex-only privacy policy.

---

## Screenshots requirements

| Path A (CWS-in-Yandex) | Use CWS screenshots already approved |
| Path B (catalog) | Follow Yandex catalog size rules when published; reuse `docs/store-assets/` subjects |

Optional: one screenshot showing install from CWS inside Yandex Browser for support docs (not required for CWS).

---

## Support URL

- https://t.me/priceguard_supportbot  
- priceguardAlsupp0rt@yandex.ru  

---

## Website URL

https://priceguard-landing.vercel.app  

---

## Install URL

**Primary (today):**  
https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf  

**Yandex-specific store URL:** `null` until a distinct catalog listing exists — do **not** invent.

---

## Review URL

**Primary:**  
https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf/reviews  

**Yandex-specific:** `null` until known.

---

## Notes for moderation / support

- Same MV3 zip as CWS 0.9.107; SHA256 in `release/0.9.107/SHA256.txt`.  
- Extension ID for CWS-in-Yandex users = **CWS ID** (`ipaichogganccpnapdgkjldplllnjlpf`) — SEO bridge already works.  
- Manual QA required: module SW, content scripts, hidden tabs (`docs/MULTI_STORE_QA.md` Yandex column).  
- Telemetry may label browser `yandex` (`YaBrowser` UA).  
- If a separate Yandex extension ID is ever assigned, append to SEO `extensionIds` and `STORE_CONFIG.yandex` only with the real value.  
- **Do not auto-publish.**
