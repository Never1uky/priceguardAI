# Changelog — PriceGuard AI

Формат: по версиям, сверху новые. Публичные формулировки для CWS — в `docs/CHROME_WEB_STORE_LISTING.md` (§2b What's New).

---

## 2.20.8 — 2026-07-17

### Product

- **Telegram как продуктовый UX:** ссылка на товар в `@PriceGuardAlertsBot` → AI-карточка, inline-кнопки (недостатки, где дешевле, история…), режим вопросов AI.
- **Серверный AI-пайплайн** (`product-intel` + `reviews-fetch`): WB + Ozon + Яндекс.Маркет; расширение предпочитает серверный полный анализ.
- **История цен на сервере** (`product_price_history`) + кнопка истории в боте.
- **Мониторинг без открытого Chrome** при привязанном Telegram (Free до 5 / Premium без лимита + приоритет).
- Карточки алертов с фото/рейтингом где доступно.

### Docs & compliance

- Privacy Policy **v2.0** (17 июля 2026): Bright Data, Telegram AI-сессии/треды, два бота, актуальный контакт `priceguardAlsupp0rt@yandex.ru`.
- Обновлены CWS listing, лендинг (hero/FAQ), README, docs hub, UX-копирайт в popup/ботах.
- Free AI в публичных текстах: **3 анализа/сутки** (согласовано с `FREE_LIMITS.maxAiRequestsPerDay` и `FREE_DAILY_AI_LIMIT`).

### Ops

- Zip: `priceguard-ai-v2.20.8.zip`
- Privacy URL для CWS: https://priceguard-landing.vercel.app/privacy

---

## Earlier

История до 2.20.8 велась в коммитах и релизных заметках в чате; с этой версии — единый `CHANGELOG.md`.
