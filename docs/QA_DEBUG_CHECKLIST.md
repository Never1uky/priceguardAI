# PriceGuard AI — полный debug и QA-чеклист

Версия: **2.20.8**  
Дата: 17 июля 2026

Используйте этот документ перед публикацией в Chrome Web Store и после каждого крупного релиза.

**Перед CWS вручную:** скриншоты 1280×800, живой Privacy URL, Confirm email OFF, smoke P0 (сравнение/Ozon/Premium/Telegram), Unlisted → Public. Детали — `docs/CHROME_WEB_STORE_LISTING.md` §0.

---

## Быстрый старт

```bash
# 1. Автоматические проверки (локально)
npm run qa:preflight

# 2. Юнит-тесты
npm run test

# 3. Сборка + zip для установки
npm run package:zip

# 4. Установка в Chrome
# chrome://extensions → Режим разработчика → Загрузить распакованное → dist/
# или загрузить priceguard-ai-v2.20.8.zip
```

---

## Фаза 0 — Автоматический preflight (все платформы)

| # | Шаг | Команда / действие | Ожидание | ✓ |
|---|-----|-------------------|----------|---|
| 0.1 | TypeScript | `npx tsc --noEmit` | exit 0 | ☐ |
| 0.2 | Юнит-тесты | `npm run test` | 160+ passed | ☐ |
| 0.3 | Production build | `npm run build` | dist/ без ошибок | ☐ |
| 0.4 | Preflight script | `npm run qa:preflight` | все ✓ | ☐ |
| 0.5 | Версии совпадают | package.json = manifest.json = zip | 2.20.8 | ☐ |
| 0.6 | Иконки на месте | icon16/32/48/128 в dist/public/icons | 4 файла | ☐ |
| 0.7 | Manifest MV3 | dist/manifest.json | service_worker, permissions | ☐ |
| 0.8 | Supabase .env | VITE_SUPABASE_URL + ANON_KEY в сборке | configured=true | ☐ |
| 0.9 | Privacy Policy URL | GitHub Pages / docs/privacy/ | открывается | ☐ |
| 0.10 | Zip артефакт | priceguard-ai-v2.20.8.zip | >200 KB | ☐ |

---

## Фаза 1 — Установка и smoke test

Проводить на **чистом профиле Chrome** (новый профиль «PriceGuard QA»).

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 1.1 | Установка | Загрузить `dist/` или zip | Иконка в панели, без ошибок | ☐ |
| 1.2 | Popup открывается | Клик по иконке | UI загружается <2 с | ☐ |
| 1.3 | Service Worker | chrome://extensions → SW | Status: active | ☐ |
| 1.4 | Console SW | Inspect service worker | нет красных ошибок при старте | ☐ |
| 1.5 | Permissions | Запрос notifications (если нужен) | диалог или уже granted | ☐ |
| 1.6 | Версия в UI | Настройки / about | 2.20.8 | ☐ |

---

## Фаза 2 — Маркетплейсы (по площадкам)

### Wildberries

| # | Шаг | URL / действие | Ожидание | ✓ |
|---|-----|----------------|----------|---|
| 2.1 | Карточка товара | wildberries.ru/catalog/…/detail.aspx | content script injected | ☐ |
| 2.2 | Скрапинг цены | Открыть popup на карточке | цена, название, артикул | ☐ |
| 2.3 | Отслеживание | «Отслеживать» | товар в «Отслеживаемое» | ☐ |
| 2.4 | История цен | Развернуть карточку | график или пустой старт | ☐ |
| 2.5 | Отзывы | Вкладка «Отзывы» → анализ | ≥5 отзывов → вердикт | ☐ |
| 2.6 | URL нормализация | URL с ?query, /feedbacks | canonical detail.aspx | ☐ |

### Ozon

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 2.7 | Карточка | ozon.ru/product/… | цена в popup | ☐ |
| 2.8 | Отслеживание | Добавить в список | лимит free: 5 | ☐ |
| 2.9 | Сравнение | Добавить в сравнение | оффер в таблице | ☐ |
| 2.10 | Отзывы | Анализ отзывов | результат или понятная ошибка | ☐ |

### Яндекс.Маркет

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 2.11 | Карточка | market.yandex.ru/product/… | скрапинг работает | ☐ |
| 2.12 | Поиск | market.yandex.ru/search | content script на search | ☐ |
| 2.13 | Сравнение | Кросс-поиск с WB | оффер YM в сравнении | ☐ |

---

## Фаза 3 — Основные функции

### Отслеживание и цены

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.1 | Добавить 5 товаров | Free tier | 6-й → сообщение о лимите | ☐ |
| 3.2 | Удалить товар | Корзина на карточке | исчезает из списка | ☐ |
| 3.3 | Фоновая проверка | Подождать alarm / перезапуск | last_checked обновился | ☐ |
| 3.4 | Целевая цена | Установить target | уведомление при достижении | ☐ |
| 3.5 | График истории | Развернуть товар | точки цен отображаются | ☐ |

### Уведомления

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.6 | Глобальный toggle | Настройки → выкл уведомления | баннер в «Отслеживаемое» | ☐ |
| 3.7 | Per-product bell | Колокольчик на карточке | Bell/BellOff, badge | ☐ |
| 3.8 | Browser notification | Симуляция падения цены | push с названием и ценой | ☐ |
| 3.9 | Пороги | min ₽ / min % | не срабатывает ниже порога | ☐ |
| 3.10 | Telegram (опц.) | Chat ID + toggle | сообщение в Telegram | ☐ |

### Сравнение

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.11 | Добавить товар | С карточки WB | в списке сравнения | ☐ |
| 3.12 | Кросс-поиск | «Найти на Ozon/YM» | офферы с ценами | ☐ |
| 3.13 | Обновить цены | Кнопка refresh | цены актуализированы | ☐ |
| 3.14 | Лимит free | 6 товаров в сравнении | блокировка / upsell | ☐ |
| 3.15 | Реферальные ссылки | Настройки → partner ID | ссылки с параметрами | ☐ |

### AI-анализ

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.16 | Анализ отзывов | WB товар с отзывами | вердикт, pros/cons | ☐ |
| 3.17 | Кэш local | Повторный анализ | fromCache, быстро | ☐ |
| 3.18 | Кэш Supabase | Другой device_id, тот же товар | fromCache remote | ☐ |
| 3.19 | Квота free | 4-й AI-запрос за сутки (лимит 3/day) | сообщение о лимите | ☐ |
| 3.20 | Локальный fallback | Supabase выключен / offline | эвристический анализ | ☐ |
| 3.21 | Полный анализ | Free в рамках 3/day | вердикт / quality; 4-й → лимит | ☐ |
| 3.22 | Полный анализ | Premium (после ЮKassa / license) | quality score, аналоги, без дневного лимита | ☐ |
| 3.23 | AI proxy test | `node scripts/test-ai-proxy.mjs` | ok: true | ☐ |

### Аккаунт и синхронизация

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.24 | Email регистрация | Auth tab | письмо / вход | ☐ |
| 3.25 | Google OAuth | Войти через Google | сессия, email в UI | ☐ |
| 3.26 | Sync tracked | Добавить на ПК A, войти на ПК B | список совпадает | ☐ |
| 3.27 | Claim device | Legacy device_id → user | данные перенесены | ☐ |
| 3.28 | Выход | Sign out | локальные данные остаются | ☐ |

### Premium и оплата

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.29 | License key (после ЮKassa) | Вставить выданный `PGAI-…` (нужен вход) | tier=premium | ☐ |
| 3.30 | Лимиты сняты | >5 tracked, AI | без блокировки | ☐ |
| 3.31 | YooKassa (test shop) | См. `docs/YOOKASSA_SMOKE.md` | redirect, webhook, Premium | ☐ |
| 3.32 | License validate | validate-license edge + JWT | ok + expiresAt | ☐ |

### Настройки

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 3.33 | AI provider | Grok ↔ GPT priority | сохраняется | ☐ |
| 3.34 | Тема | Light / Dark | применяется | ☐ |
| 3.35 | Test AI connection | Кнопка в настройках | «подключение успешно» | ☐ |
| 3.36 | Referral settings | WB erid, Ozon tag | в ссылках офферов | ☐ |

---

## Фаза 4 — Тестирование на разных устройствах

### Матрица устройств

| Устройство | ОС | Chrome | Профиль | Ответственный | Дата | ✓ |
|------------|-----|--------|---------|---------------|------|---|
| Desktop A | Windows 10/11 | Latest stable | QA чистый | | | ☐ |
| Desktop B | Windows 11 | Latest stable | Основной | | | ☐ |
| Desktop C | macOS 14+ | Latest stable | QA чистый | | | ☐ |
| Desktop D | Linux (Ubuntu) | Latest stable | QA чистый | | | ☐ |
| Laptop | Windows 11 | Beta/Dev (опц.) | QA | | | ☐ |
| Remote | Другой ПК / VM | Stable | Sync test | | | ☐ |

> **Примечание:** Chrome Extensions работают только на desktop (Windows, macOS, Linux, ChromeOS). Мобильный Chrome не поддерживает расширения — тестируйте только desktop.

### Минимальный набор на каждом устройстве (30 мин)

| # | Сценарий | Win | Mac | Linux | ✓ |
|---|----------|-----|-----|-------|---|
| 4.1 | Установка из zip | ☐ | ☐ | ☐ | |
| 4.2 | Popup + вкладки | ☐ | ☐ | ☐ | |
| 4.3 | WB: цена + track | ☐ | ☐ | ☐ | |
| 4.4 | Ozon: сравнение | ☐ | ☐ | ☐ | |
| 4.5 | AI анализ (1 запрос) | ☐ | ☐ | ☐ | |
| 4.6 | Уведомление (mock) | ☐ | ☐ | ☐ | |
| 4.7 | Auth Google (если настроен) | ☐ | ☐ | ☐ | |
| 4.8 | Перезапуск браузера | SW alive, данные на месте | ☐ | ☐ | ☐ |

### Кросс-устройственная синхронизация (2 устройства)

| # | Шаг | Устройство A | Устройство B | ✓ |
|---|-----|--------------|--------------|---|
| 4.9 | Вход одним аккаунтом | Добавить 3 товара | Войти → видны 3 | ☐ |
| 4.10 | Удаление | Удалить 1 на A | Обновить B → 2 товара | ☐ |
| 4.11 | Offline A | Добавить товар offline | Online B после sync | ☐ |

---

## Фаза 5 — Edge cases и регрессии

| # | Сценарий | Действие | Ожидание | ✓ |
|---|----------|----------|----------|---|
| 5.1 | Reload extension | chrome://extensions → Reload | SW перезапустился, данные OK | ☐ |
| 5.2 | Invalidated context | Reload ext во время скрапа | safeRuntimeSend, не crash | ☐ |
| 5.3 | Много вкладок | 10+ вкладок WB | popup на active tab | ☐ |
| 5.4 | Не-product URL | google.com | popup без ошибок | ☐ |
| 5.5 | Товар без отзывов | Новый товар | «недостаточно отзывов» | ☐ |
| 5.6 | Force reanalyze | Кнопка обновить анализ | новый результат | ☐ |
| 5.7 | Rate limit AI | 40+ запросов/час | 429, понятное сообщение | ☐ |
| 5.8 | Supabase down | Отключить сеть к *.supabase.co | локальный fallback | ☐ |
| 5.9 | Очистка данных | Clear extension data | чистое состояние | ☐ |
| 5.10 | Обновление версии | Установить поверх старой | миграция storage OK | ☐ |

---

## Фаза 6 — Debug: где смотреть логи

| Компонент | Как открыть | Что искать |
|-----------|-------------|------------|
| Service Worker | chrome://extensions → Inspect SW | `[PriceGuard]`, ошибки fetch |
| Popup | ПКМ на popup → Inspect | React errors, network |
| Content script | DevTools на странице WB/Ozon | scrape errors |
| Network | DevTools → Network | ai-proxy, product-cache |
| Storage | DevTools → Application → Extension storage | priceguard_* keys |
| Alarms | SW console: `chrome.alarms.getAll(console.log)` | price-check alarms |

### Полезные команды в SW console

```javascript
// Состояние storage
chrome.storage.local.get(null, console.log);

// Отслеживаемые
chrome.storage.local.get('priceguard_storage', console.log);

// AI квота
chrome.storage.local.get('priceguard_ai_daily_quota', console.log);

// Device ID
chrome.storage.local.get('priceguard_device_id', console.log);
```

### Live E2E (опционально, тратит токены)

```bash
# Нужен .env с VITE_SUPABASE_*
E2E_LIVE=1 npm run test -- src/e2e/live-pipeline.test.ts
E2E_AI_LIVE=1 npm run test -- src/e2e/live-pipeline.test.ts
```

### Scrappey / server unlocker smoke

| # | Шаг | Команда / действие | Ожидание | ✓ |
|---|-----|-------------------|----------|---|
| 6.1 | Local Scrappey | `SCRAPPEY_API_KEY=… npm run smoke:scrappey` | Ozon/YM/WB HTML + price parse | ☐ |
| 6.2 | Edge product-intel Ozon | POST product-intel analyze URL | `ok` + `card.price` | ☐ |
| 6.3 | Edge product-intel WB | POST product-intel WB detail URL | `ok` + `card.price` | ☐ |
| 6.4 | Edge reviews-fetch Ozon | POST reviews-fetch | `ok`, `usedUnlocker: true` | ☐ |
| 6.5 | Cron update-prices | POST + `x-cron-secret` | `scrappeyConfigured: true` | ☐ |

### Telegram product-intel (@PriceGuardAlertsBot)

| # | Шаг | Действие | Ожидание | ✓ |
|---|-----|----------|----------|---|
| 6.6 | /start | Команда боту | Chat ID + инструкция | ☐ |
| 6.7 | Ссылка на товар | URL WB/Ozon/YM | карточка + кнопки `pi:*` | ☐ |
| 6.8 | pi:cheap | Callback «Где дешевле» | офферы / Scrappey path | ☐ |
| 6.9 | pi:hist | Callback «История» | точки / нет данных | ☐ |
| 6.10 | pi:ask | Вопрос AI по товару | ответ через ai-proxy | ☐ |
| 6.11 | /add + /status | Добавить товар, статус | в списке, last_checked | ☐ |
| 6.12 | Support bot | @priceguard_supportbot /help | команды, /mykey | ☐ |

### Landing HTTP

| # | URL | Ожидание | ✓ |
|---|-----|----------|---|
| 6.13 | `/` `/offer` `/privacy` `/requisites` `/payment/success` | HTTP 200 | ☐ |
| 6.14 | `/privacy` текст | Scrappey (не Bright Data), 299/2490 | ☐ |

---

## Фаза 7 — Chrome Web Store readiness

| # | Пункт | Статус |
|---|-------|--------|
| 7.1 | Privacy Policy URL (RU) | `…/privacy/` |
| 7.2 | Privacy Policy URL (EN) | `…/privacy/en.html` |
| 7.3 | Single purpose description | в CHROME_WEB_STORE_LISTING.md |
| 7.4 | Permission justifications | в CHROME_WEB_STORE_LISTING.md |
| 7.5 | 5 скриншотов 1280×800 | ☐ |
| 7.6 | Иконка 128×128 | ☐ |
| 7.7 | Promo tile 440×280 | ☐ |
| 7.8 | Краткое описание ≤132 символов | ☐ |
| 7.9 | zip загружен в CWS dashboard | ☐ |
| 7.10 | Data use disclosure заполнен | ☐ |

---

## GitHub Pages — деплой Privacy Policy

1. Репозиторий → **Settings** → **Pages**
2. Source: **Deploy from branch** → `main` → folder **`/docs`**
3. Save → URL: `https://<user>.github.io/priceguard-ai/privacy/`
4. В Chrome Web Store укажите этот URL

Проверка локально:
```bash
npx serve docs -p 3333
# http://localhost:3333/privacy/
```

---

## Шаблон отчёта о тестировании

```
Дата: ___________
Версия: 2.20.8
Тестировщик: ___________

Автотесты: PASS / FAIL
Устройства: Windows ___ / macOS ___ / Linux ___

Критические баги: ___
Средние: ___
Мелкие: ___

Блокеры для релиза: ДА / НЕТ

Подпись: ___________
```

---

## Критерии готовности к публикации

- [ ] Все пункты Фазы 0 — PASS
- [ ] Smoke (Фаза 1) на Windows + ещё одной ОС
- [ ] WB + Ozon + YM (Фаза 2) — минимум по 2.1–2.5, 2.7–2.10, 2.11–2.13
- [ ] Уведомления + AI + Premium (3.6–3.12, 3.16–3.22)
- [ ] Нет критических багов
- [ ] Privacy Policy опубликована по URL
- [ ] zip v2.20.8 собран
