# Changelog — PriceGuard AI

Формат: по версиям, сверху новые. Публичные формулировки для CWS — в `docs/CHROME_WEB_STORE_LISTING.md` (§2b What's New).

---

## 0.9.97 — 2026-08-08

- **License activate race:** `validate-license` больше не делает check-then-increment в JS; атомарный RPC `activate_license_device` (row lock на `license_keys`) — лимит устройств нельзя обойти параллельными активациями.

## 0.9.96 — 2026-08-04

### Stability

- **Compare jobs:** parallel running markers (multi product ids) + keepAlive refcount — один job больше не гасит чужой SW/running.
- **Background messaging:** async handlers всегда отвечают `sendResponse` (ok/err) — popup не зависает.
- **Lint gate:** рабочий ESLint flat config; зелёные unit/e2e asserts (multi-user promote, WB SERP cascade).
- **Policy sync:** тест констант multi-user mapping extension ↔ Edge; убрана мёртвая ветка card-cascade.

---

## 0.9.90 — 2026-07-24 (Early access)

### Hygiene / CWS

- Prod: `esbuild.drop: ['console','debugger']`; zip без дубля top-level `icons/` (только `public/icons/*`).
- Privacy **v2.4**: явные поля automatic support-report (message ≤800, context, version, userId).
- Листинг / RELEASE_GO: **Early access** (не Beta); What's New для 0.9.90.

### Limits

- **Premium / trial:** до **50** товаров («Мои товары» / track / TG / `update-prices`); Free по-прежнему 5. AI freemium без изменений (3/сутки Free).

---

## Unreleased — AI cache confidence

### Feature

- **Confidence-based AI cache reuse:** thresholds/weights in `src/lib/ai/cache-config.ts`; score 0–100 by brand/model/article/storage/color/category.
- **Reasons:** `LOCAL_CACHE` / `REMOTE_CACHE` / `SAME_SKU` / `CROSS_MARKETPLACE` / `REVIEWS_MATCH` / `SOFT_REFRESH` / `NEW_ANALYSIS` — badge in UI.
- **Cross-MP:** reuse via `cross_market_mapping` (manual/multi_user or auto≥85) + feature confidence ≥80; **no Sonar** on cache path.
- `canonicalProductId` for telemetry/indexing when brand+model known.

---

## Unreleased — Cost-cut AI pipelines

### Feature

- **Lite vs deep AI:** «Запустить AI-анализ» = Grok/GPT-mini без Sonar (Free + Premium default). Кнопка **«Глубокий разбор»** = Sonar→GPT (Premium/trial; Free → upsell).
- **Sonar:** shared `product_cache` v3 TTL **14 дней**; daily cap **5** live Sonar/user (UTC); cache hits не считаются; soft refresh / hydrate не зовут Sonar.
- **TG / product-intel:** cache-first; generate default lite (Premium tier ≠ Sonar).
- **update-prices:** Free freshness **6 ч**, Premium **3 ч** (SKU coalesce без изменений). Scrappey: request→browser already.

### Docs

- Premium copy: deep web analysis, не «Sonar на каждый клик».

---

## Unreleased — Telemetry


### Feature

- **Client telemetry:** `src/lib/telemetry/*` — local ring, Verbose/Normal/Silent, opt-in remote WARN/ERROR.
- Instrumentation: compare jobs, marketplace search, cascade/card fetch, match reject reasons, parsers (antibot/empty), Edge `callEdgeSafe`, AI proxy sizes (no prompts), Telegram send.
- Settings → **Диагностика (dev)** — полная панель (mode / remote / Copy·Export); обычным пользователям — только **Скачать отчёт для поддержки** в Конфиденциальности.
- Edge `telemetry-ingest` + table `telemetry_events`; revived soft `search-metrics` on FINAL_RESULT.
- Docs: `docs/TELEMETRY.md`; privacy EN/RU updated for opt-in remote.

---

## Unreleased — Telegram Alerts UX

### Feature

- **@PriceGuardAlertsBot:** Reply Keyboard (Мои товары / AI / FAQ / Помощь); `/status` — до 5 карточек с inline Анализ · Сравнение · Удалить (confirm).
- **AI cache-first** (`st:ai` / `st:ai_refresh`), сравнение только из кэша (`compare_products` / mapping + `price_scrape_cache`), строка min90 в карточке.
- **FAQ inline tree** + deep-link @priceguard_supportbot; opt-in утренний дайджест (`digest_enabled` + Edge `daily-user-digest`).
- BotFather: публично `start` / `help` / `status` / `add`; `/chatid` `/cancel` `/remove` скрыты.

Миграция: `20260723215943_digest_enabled.sql`. Cron: `supabase/scripts/setup-daily-digest-cron.sql`.

---

## Unreleased — Trial anti-abuse

### Feature

- **Trial claim:** пробный Premium только после Telegram Chat ID в облаке; Edge `claim-trial` + таблица `trial_claims` (UNIQUE chat_id + device_id). Платный Premium без Telegram. Миграция `20260723210000_trial_claims.sql`.

---

## Unreleased — Edge hardening

### Security / Hardening

- **`reviews-fetch`:** internal-only (`x-cron-secret` / service_role); optional JWT via `ALLOW_REVIEWS_FETCH_JWT=1` + `edge_request_log` rate limit.
- **`cross-market-map`:** dispute/reportFail 24h cooldown per user/edge; low-confidence manual → `unverified`; lookup `unverifiedAlternates`.
- **Crowd promote:** distinct users ≥2, avg confidence ≥70, title gates, 7d reject/dispute block; `match_feedback.user_id`.
- **`product_cache`:** shared `_shared/product-cache-store.ts`; `update-prices` invalidates v1/v2 on Δ≥10% or ≥500₽.
- **`compare-research`:** top-1 card verify → `serverVerified` / `serverMatchConfidence` / `serverTitle`.

Миграция: `20260723120000_edge_hardening_p0_p1.sql`. Docs: `docs/AI_CACHE_PROXY.md` §6.

---

## 0.9.70 — 2026-07-23

### Docs / CWS

- **Unlisted prep:** `RELEASE_GO` + listing → `0.9.70`; `YOOKASSA_SMOKE.md`; optional `docs/sql/disable-demo-license-keys.sql`. Client confirmed without DEMO license UI.

---

## 0.9.69 — 2026-07-23

### Fix

- **OOS / not_found unbound:** `finalizeResearchOffer` clears product-card URL; `getStoredProductPageUrl` ignores oos/not_found/blocked (кроме manual) — refresh/research не парсят мёртвую карточку как bound.

---

## 0.9.68 — 2026-07-23

### UI

- **Review cards:** превью отзывов — карточки с аватаром, именем+датой, clamp «Читать полностью», AI Insight по rating; skeleton/empty; `dateLabel` из WB timestamp.

---

## 0.9.67 — 2026-07-23

### Feature

- **Picker «Не тот товар»:** отклонение каждого кандидата в `needs_choice`; URL в `rejectedOfferUrls` (персистент); повторный поиск исключает их через `excludedUrls`; все отклонены → `not_found` + ручная ссылка.

### Fix

- **Camera vs battery/case:** «Аккумулятор/чехол … Nikon D5100» → `accessories`, не `cameras` — не попадают в топ `needs_choice` для фотоаппарата.

---

## 0.9.66 — 2026-07-23

### Security

- **License activate requireAuth:** `validate-license` требует JWT; UI скрывает ввод ключа без входа; `activateLicenseKey` / sync не активируют и не сбрасывают Premium без сессии.

---

## 0.9.65 — 2026-07-23

### Fix

- **Host vs accessory query:** console/phone/printer titles with DualSense/чехол/картридж in kit or specs stay `primary` — SERP no longer prepends «контроллер»; real DualSense/чехол/картридж SKUs stay accessory. `inferProductModel` no longer treats raw specs dump as model.

---

## 0.9.64 — 2026-07-23

### Fix

- **OOS / cascade:** `enrichOfferFromProductPage` no longer keeps stale priced offers; bound refresh uses `forceTab`, advances pool / re-SERPs; OOS URLs not re-bound; no SERP-price auto-pick after OOS card.
- **Stuck «Ищем…»:** settle `loading_card` on supersede; popup reads `RUNNING_KEY` when only `SEARCHING_MP` changes.
- **Labels:** YM Pay-only keeps `payPrice` → «цена с Пэй»; Ozon «с банками» → «с озон банк».

---

## 0.9.63 — 2026-07-23

### Fix

- **«Найти на Я.Маркет»:** empty slots from `offersFromCompareProduct` get `matchStatus: not_found` + error so ComparisonTable shows research CTA.
- **needs_choice wipe (ENSURE):** opening a candidate URL selects that candidate instead of `researchClearAutoOnly`; soft ENSURE uses `preservePendingChoice`; popup syncs offers on `marketplaceOffers` updates.

---

## 0.9.62 — 2026-07-23

### Fix

- **needs_choice persist (round 2):** `preferRicherMarketplaceOffer` (pending > empty not_found; richer pool / newer `comparedAt`); strip polluted `marketplaceUrls` while picker open; ignore non-manual bound URLs in `getStoredProductPageUrl`.

---

## 0.9.60 — 2026-07-23

### Fix

- **needs_choice wipe:** shell URL = search (не карточка кандидата); refresh/`getStoredProductPageUrl` не считают picker bound; фон skip running compare job.

---

## 0.9.59 — 2026-07-23

### Fix

- **needs_choice persist:** merge offers/products не затирает picker (`searchCandidates`) пустым `not_found` (stale cloud sync / reopen popup).

---

## 0.9.58 — 2026-07-23

### Fix

- **WAR matches:** post-build нормализует `web_accessible_resources.matches` до `scheme://host/*` (path-паттерны из content_scripts ломали Load unpacked в Chrome).

---

## 0.9.57 — 2026-07-23

### Fix

- **HiddenBrowser race:** `runExclusive` сериализует полный цикл navigate→wait→scrape (ручная ссылка больше не читает чужой DOM mid-research).
- **Ozon hydrate:** один длинный retry при пустых `widgetStates` / HTTP card timeout 20s на втором проходе.
- **Ручная привязка:** `unverified_manual` при confidence < 70 (без compare-алертов); `clearPriceHistory` при смене article; UI history через `stableProductStorageId`.

---

## 0.9.55 — 2026-07-23

### Fix / UX

- **Точечный поиск площадки:** в строке «Не найдено» — «Найти на …» (`RESEARCH_SINGLE_MARKETPLACE`), без сброса успешных привязок; полный «Найти заново» остаётся в шапке.
- **Я.Маркет 429:** меньше retries / короче delay на search и card fetch — быстрее fail и ручной ретрай.

---

## 0.9.53 — 2026-07-23

### Fix / Hardening

- **WAR / content graph:** content → `@/lib/storage-local` (без supabase); Vite post-build dedupe/narrow `web_accessible_resources` + fail if `edge-*` in WAR.
- **Prod console:** esbuild `pure` strips `console.log` / `debug` / `info`.
- **Pick-retry:** exponential backoff 1m→5m→15m, drop after 3 attempts.
- **Full-analysis cache:** invalidate when price moves ≥10% or ≥500 ₽ (`priceAtSave`).
- **CWS docs:** expanded §9 justifications + data use / no-sale note.

---

## 0.9.52 — 2026-07-22

### Security / Release

- **Edge auth P0:** `ai-proxy` и `reviews-fetch` требуют JWT; writes `cross-market-map` / `match-feedback` — JWT; Telegram webhooks требуют secret; пустой `METRICS_ADMIN_EMAILS` = deny-all; revoke anon SELECT на metrics views.
- **Privacy v2.3:** MD + HTML + landing; ссылка Privacy / удаление данных в Settings; soften search_metrics; document match-feedback / compare-research / auto support-notify / Scrappey beyond TG-only.
- **Docs:** RELEASE_GO + CWS listing → 0.9.52 Beta.

---

## 0.9.50 — 2026-07-22

### Fix

- **MV3 Service Worker:** убраны runtime `import()` на SW-reachable путях (card scrape / HiddenBrowser / PendingSync / Edge soft-fail). Chrome запрещает dynamic import в `ServiceWorkerGlobalScope` — из‑за этого cascade карточки давал «Ошибка загрузки» / «Товар не найден» после успешного SERP. Статические ES imports + Vite post-build guard (в т.ч. neutralize optional `@opentelemetry/api` из supabase-js).

---

## 0.9.48 — 2026-07-22

### Feature

- **Runtime Resilience Layer (MVP):** `safeFetch` (timeout, exp backoff+jitter, typed `NetworkFailure`); Edge `callEdgeSafe` retries 5xx silently (no user-facing HTTP 502); `safeSendMessage` / `ensureContentScriptReady` / `waitForDomReady`; `safeRuntimeSend` retries Receiving end; `PendingSync` outbox for `compare-sync` + `price-cache` put with alarm/popup flush.

---

## 0.9.47 — 2026-07-22

### Feature

- **Entity-role matching:** declarative rule pack (`match-rules`) + `extractEntityFromTitle` разделяет primary entity / compatibility host / marketing; SERP lead строится из primary (не host); hard gate accessory|consumable|part|supply ↔ host primary той же family → score 0. Hybrid pack interface (bundled now, remote overlay later).

---

## 0.9.46 — 2026-07-22

### Fix

- **CandidatePicker WB:** SERP parse заполняет `imageUrl` / `imageUrlAlternatives` через `buildWbImageUrl` (basket CDN); UI переиспользует `ProductImage` с onError-fallback; `host_permissions` для `https://*.wbbasket.ru/*`.

---

## 0.9.45 — 2026-07-22

### Fix

- **Compare UI «Поиск…»:** leftover `loading_card` финализируется в `not_found` (finalize + settle на crash/job end); SEARCHING_MP всегда clear в finally; в ячейке CTA «Найти заново» при терминальном пустом слоте; searching только для running productId.
- **Match warn:** не показывать «другая категория» для совместимых TV при conf 55–64; category-warn только при incompatible / weak generic↔specific; soft confidence-warn только при слабом title score; DualSense → accessories (не console).

---

## 0.9.44 — 2026-07-22

### Fix

- **Match feedback / mapping:** dispute demotes confidence (−35) и hits; auto upsert не реактивирует disputed/dead и блокируется recent reject в `match_feedback`; multi_user не promote при rejects ≥ half accepts.
- **Категории:** `networking` (точка доступа / AP / router); generic↔specific score cap 0.35; UI dismissible предупреждение при другой категории / низкой уверенности (`WARN_MATCH_CONFIDENCE`).
- **Поколения:** Buds 5 ≠ Buds 6 (lineage+digit); lookup/remember не принимают version conflict; iPhone 13≠14 регрессия сохранена.

---

## 0.9.43 — 2026-07-22

### Fix

- **Ложные / ранние алерты:** не алертить OOS и `serp_only` после OOS-card; catastrophic sanity на `cheaper_elsewhere` (cross-MP); compare grace 45 мин после `addedAt`; первый priced sibling = baseline, не алерт.
- **Категории:** non-generic `catA !== catB` → score 0; cascade/pool без dump всего SERP → `not_found` вместо мусорного `needs_choice` (Buds≠iPhone).
- **Мои товары:** collapse сбрасывает focus; expand только при смене `focusCompareId`; сортировка по `addedAt` (не `comparedAt`) + UI selector; skip merge/reload во время running/expand; parallel progress serialize + final apply на last snapshot.

---

## 0.9.42 — 2026-07-21

### Fix

- **Мои товары / compare mix-up:** `articlesIntersect` только по ключу `mp:article` (не WB↔Ozon по голым цифрам); перед merge — guard brand/category (Nikon ≠ Oral-B); `expandedId` = `item.id` строки с `compareId===focusCompareId`. Тесты: numeric article на разных MP / Nikon+Oral-B → не duplicate.

---

## 0.9.41 — 2026-07-21

### Fix

- **WB отзывы / CORS:** `fetchWildberriesReviews` — `credentials: 'omit'`, до 4 URL (не 8), только из SW; content script на карточке — DOM-only (без feedbacks API → нет CORS Issues). Сбор отзывов только PREVIEW (вкладка Отзывы) / полный анализ по кнопке; compare / ENSURE / Current price не трогают; `skipWhileCompareRunning` сохранён. CSP/Sentry на сайте WB не чинили манифестом.

---

## 0.9.40 — 2026-07-21

### Fix

- **Research empty slots:** после поиска Ozon/YM без цены — явный `not_found` + error (не вечное «Нет цены»); `finalizeResearchOffer` / merge не тащит stale price; CTA «Найти заново» в колонке; лог SW `[PriceGuard] compare done` с per-MP `{matchStatus, found, price?, error?}`; без авто-повторного research; пороги confidence не трогали.

---

## 0.9.39 — 2026-07-21

### Fix

- **Синхронизировать (Аккаунт):** cloud-only путь (claim → параллельно tracked/compare/premium/alerts); hydrate картинок по-прежнему fire-and-forget; общий soft timeout ~25s (не 25s×шаг); кнопка всегда `force` + toast («Синхронизация выполнена» / что восстановилось / таймаут); без research; лог `[PriceGuard Auth] post-login` с `timedOut`/`error`/`elapsedMs`.

---

## 0.9.38 — 2026-07-21

### Fix

- **Alerts Bug B:** cross-MP «нашли дешевле» больше не уходит как `compare_price_drop` на источник. Алерты используют тот же `offerMatchStatus`, что UI (`verified`/`probable`/`serp_only`); guard против price-bleed (YM.newPrice ≈ Ozon); URL кнопки обязан совпадать с marketplace; лог `[PriceGuard] compare alerts plan`.

---

## 0.9.37 — 2026-07-21

### Fix

- **Алерты cross-MP:** «нашли дешевле» больше не маскируется под «снижение на источнике»; URL/кнопка = дешёвая площадка; baseline = старая цена источника; guard против price-bleed; dedupe `drop:` vs `cheaper:`.
- **Синхронизировать:** hydrate картинок не блокирует Sync (fire-and-forget); toast успех/ошибка/таймаут; soft timeout 25s на cloud-шаги.

---

## 0.9.36 — 2026-07-21

### UX / Match / Alerts

- **Категории:** `accessories`, `tvs`, `monitors` + hard reject чехол/плёнка/кабель ↔ смартфон/ноутбук; TV ↔ монитор; accessories до smartphones в infer.
- **Empty-state:** в ячейке not_found / antibot — «Найти заново» + VPN_SEARCH_HINT.
- **«Ищем…»:** toast/badge только если research реально started; иначе warning «Поиск не запустился…».
- **Рейтинг:** после bind — мягкий enrich с карточки (`skipUnlocker`); в таблице «…» вместо вечного «нет данных».
- **Онбординг update:** one-shot toast после `onInstalled` reason=update → «Синхронизировать» в Аккаунт.
- **Alert dedupe:** cooldown key по article / stable identity — один Telegram/Chrome notify на логический товар.
- **Диагностика:** свёрнутый блок в Настройках (Premium/dev) — version, server monitoring, email mask, running id.

---

## 0.9.35 — 2026-07-21

### Fix / UX

- **Текущая цена:** убрана мёртвая icon-кнопка «Обновить»; осталась «Открыть на площадке».
- **Фото:** skeleton вместо broken img+alt; sync WB CDN seed до первого paint; Reviews picker берёт image alternatives как в «Мои товары».
- **Аккаунт:** подсказка рядом с «Синхронизировать» — после обновления расширения нужно синхронизировать лицензию.

---

## 0.9.34 — 2026-07-21

### Fix

- **Мои товары dedup:** один товар с разных МП сливается по общему URL/артикулу (в т.ч. offer URLs); при загрузке списка существующие дубли схлопываются.
- **Мониторинг цен:** periodic compare = только `refresh` bound-карточек; при server monitoring — backup только для stale; клиентский backup без Scrappey unlocker.
- **Категории:** `gpus` / `desktops` + hard reject ноутбук ↔ видеокарта/ПК/трафарет RTX.

---

## 0.9.32 — 2026-07-21

### Fix

- **Ozon picker titles:** promo («250 баллов», «Рекомен…») больше не показываются — fallback из slug URL, название с карточки при cascade, placeholder вместо бейджа.
- **«В «Мои товары»»:** research как «Найти заново» — `forceCompare`, сброс lock/привязок, `runCompareJob(..., true)`.

---

## 0.9.31 — 2026-07-21

### Fix

- **Ozon alternatives:** promo badges («Распрод», «Осталось N шт», «Рекомен…») больше не подставляются как названия кандидатов — фильтр в SERP/API/DOM/cascade + fallback в UI.
- **Мои товары:** иконка удаления не крутится при раскрытии карточки (отдельный `expandingId` от `busyId`).

---

## 0.9.30 — 2026-07-21

### Product / Match

- **Popular categories:** wearables, home_textile, home_goods, kids, sports plugins; extended appliances (robot vacuum, multicooker), apparel/shoes/cosmetics/pet_food/power_tools infer + stripQueryNoise; MODEL_PATTERNS (JBL, Amazfit, Roborock, Redmond, Samsung WW); `docs/DEMO_PRODUCTS.md`.

---

## 0.9.29 — 2026-07-21

### Product / Match

- **Search architecture:** lenses, consoles, power_tools, appliances categories + stripCategoryQueryNoise; Phase B template in match-category.

---

## 0.9.27 — 2026-07-21

### Product / Match

- **Search architecture:** lenses, consoles, power_tools, appliances categories + stripCategoryQueryNoise; Phase B template in match-category.

---

## 0.9.26 — 2026-07-21

### Fix

- **Мои товары:** delete без flash (sequential remove + guard storage reload).
- **Compare:** «Найти заново» сохраняет manual/verified; cameras match profile; SERP title без «N баллов»; enrich rating на finalize.

---

## 0.9.25 — 2026-07-21

### Fix / UX

- **Мои товары:** nested buttons → delete/alerts; remove both compare+tracked (no guest resurrect); search spinner + toast.
- **Titles:** не сохранять «Товар на Ozon/WB/YM» в compare; pick/AI/auth/Telegram copy; popup tab persist.

---

## 0.9.24 — 2026-07-20

### Fix

- **Realtime storm:** debounce 1.8s + ignore own push + sync cooldown; quieter logs.
- **Cloud/VPN:** Settings warn when supabase/Telegram sync fails (DNS/Zapret); Chat ID link → @pricealertbot.

---

## 0.9.23 — 2026-07-20

### Fix

- **Ozon SERP:** retry global search after `/category/` redirect; poll widgets/DOM for `/product/` tiles.
- **Compare pick:** `ya.ru` + relative URLs; pass candidate rating into table; ExternalLink resolves absolute URL.
- **Free AI:** short retry collect reviews before MIN=5 gate (quota unchanged).

### Docs

- CWS screenshots: обновлены под UI popup 0.9.x (7×1280×800 в `docs/store-assets/`).

---

## 0.9.21 — 2026-07-20

### Fix / Product

- **AI Premium:** полный анализ без отзывов на карточке (Sonar web-first); Free — минимум 5 отзывов.
- **Tier expiry:** lazy downgrade paid Premium → clear `user_premium` на сервере; trial → только local Free.

### QA smoke

- Trial истёк → «Бесплатный тариф», AI 3/день, TG без priority.
- Paid expired → то же; `/status` без premium label.
- «Обновить» в Мои товары после downgrade.

---

## 0.9.20 — 2026-07-20

### Fix

- **Sync tracked ↔ Telegram:** reconcile удалений (tombstone + pending queue); «Обновить»/удаление чистит зомби на сервере; /status Free «N из 5»; `/remove`.

---

## 0.9.19 — 2026-07-19

### Fix

- **Premium/Telegram:** приоритет алертов только при живом `license_keys`; deactivate / expired license сбрасывает `user_premium` (больше нет «приоритет Premium» у Free).

---

## 0.9.18 — 2026-07-19

### Fix

- **SW:** static imports вместо `import()` на compare sync / jobs / storage / full-analysis (MV3).
- **UI:** скидка на карточке — без формулировки «зачёркнутая цена».

---

## 0.9.17 — 2026-07-19

### Product

- **Убран устаревший виджет на странице** (purple page-panel). Добавление в «Мои товары» и слежение — только в popup расширения.

---

## 0.9.15 — 2026-07-19

### Fix

- **AI Free quota:** клик «Запустить» + любой успешный результат (живой или cache hit) списывает 1; тихий hydrate кэша и soft refresh — нет; job в session переживает закрытие popup; UI «Из кэша · попытка учтена» vs «Из кэша».

---

## 0.9.14 — 2026-07-19

### Fix

- **Рейтинг в сравнении:** `mergeOfferRating` не затирает SERP/карточечный rating null-ом при refresh цены; нормализация «4,5» / «из 5»; Ozon SERP DOM и hidden-tab meta дотягивают rating до offer; UI «нет данных» с title без ложных обещаний.

---

## 0.9.13 — 2026-07-19

### Fix

- **Мои товары:** единый `resolveAddToMyProductsResult` — успех = tracked ИЛИ compare; ENSURE/research fail при наличии в списке → warning/ok, не красный fail; re-read storage + короткий retry после ENSURE.

---

## 0.9.12 — 2026-07-18

### Product

- **Мои товары:** нет ложного toast fail, если tracked уже сохранён, а ENSURE/research не стартовал (warning вместо «не удалось добавить»).
- **Ozon SERP:** DOM fallback при пустых widgetStates + понятное сообщение при antibot (без Scrappey).
- **VPN:** подсказка в Настройках и мягкий hint при блокировках поиска.

---

## 0.9.11 — 2026-07-18

### UI

- Polish перед CWS: «Ссылка» в сравнении, короткие ошибки поиска, «Заменить ссылку» на найденных, пустой ProductContextBar вне карточки МП.
- Тексты: плейсхолдеры всех МП, без дублей AI/зачёркнутой цены, порог алертов (AND), грамматика истории, beta/DEV accordion, Telegram CTA.

---

## 0.9.10 — 2026-07-18

### Product

- **Alerts:** Telegram grace 6h после добавления в «Мои товары» (Chrome-уведомление остаётся).
- **Hidden browser:** не пишет в «Цены»/lastScraped; acquire/release + idle close после research.

---

## 0.9.09 — 2026-07-18

### Product

- **Match A+B:** нормализация атрибутов (`attr-normalize`) + категорийные профили матчинга (смартфоны, ноутбуки, наушники, одежда, обувь, химия, косметика, корм, generic); размер одежды — soft.

---

## 0.9.08 — 2026-07-18

### Product

- **Price identity:** drop/target/Telegram алерты только при совпадении marketplace+article/canonical URL; stale cache SPA не подмешивает чужой SKU.

---

## 0.9.07 — 2026-07-18

### Product

- **Мои товары:** одна кнопка «В Мои товары» = слежение + research; убрана «Найти на других».
- Лимит Free: soft-grandfather (существующие URL ок); понятный toast без шума в Telegram.

---

## 0.9.0 — 2026-07-17 (Beta)

Первая публичная beta-версия для CWS (ранее локально шли 2.20.x / 2.21.0 — в витрину не загружались).

### Product

- **Сравнение:** «Обновить данные» обновляет только привязанный URL (без тихой подмены из пула кандидатов).
- **Match score:** минимальная уверенность удержания оффера **55**; auto-pick по-прежнему **70** + совместимость бренда.
- **Ручная ссылка:** подтверждение, если conf &lt; 70, другой бренд или замена уже найденного оффера.
- **Нет в наличии:** явный статус для карточек без цены; алерты не шлются при смене URL на другой товар.
- **UI:** подпись `v0.9.0 · Beta` в шапке popup и заметка в Настройках.

### Ops

- Zip: `priceguard-ai-v0.9.0.zip`

---

## 2.21.0 — 2026-07-17 (локально, superseded)

Локальный билд match-gates; заменён на **0.9.0** перед первой загрузкой в CWS.

- Zip (устарел): `priceguard-ai-v2.21.0.zip`

---

## 2.20.8 — 2026-07-17

### Product

- **Telegram как продуктовый UX:** ссылка на товар в `@PriceGuardAlertsBot` → AI-карточка, inline-кнопки (недостатки, где дешевле, история…), режим вопросов AI.
- **Серверный AI-пайплайн** (`product-intel` + `reviews-fetch`): WB + Ozon + Яндекс.Маркет; расширение предпочитает серверный полный анализ.
- **История цен на сервере** (`product_price_history`) + кнопка истории в боте.
- **Мониторинг без открытого Chrome** при привязанном Telegram (Free до 5 / Premium без лимита + приоритет).
- Карточки алертов с фото/рейтингом где доступно.
- **Scrappey** вместо Bright Data для server-side unlocker (Ozon/YM цены, отзывы, Telegram cron, `/add`, «где дешевле»).

### Docs & compliance

- Privacy Policy **v2.0** (17 июля 2026): Scrappey, Telegram AI-сессии/треды, два бота, актуальный контакт `priceguardAlsupp0rt@yandex.ru`.
- Обновлены CWS listing, лендинг (hero/FAQ), README, docs hub, UX-копирайт в popup/ботах.
- Free AI в публичных текстах: **3 анализа/сутки** (согласовано с `FREE_LIMITS.maxAiRequestsPerDay` и `FREE_DAILY_AI_LIMIT`).

### Ops

- Zip: `priceguard-ai-v2.20.8.zip`
- Privacy URL для CWS: https://priceguard-landing.vercel.app/privacy
- Dead-code cleanup: удалены неиспользуемые UI/lib (`ProductCard`, `DataSourceBanner`, …), dead message handlers, клиенты `search-alerts`/`search-metrics`. Edge `search-alerts` / `search-metrics` / `reviews-fetch` / `weekly-metrics-digest` — candidates for undeploy (нет in-repo caller).
- Performance: idempotent SW listeners; singleflight price checks / compare jobs; product-intel lookup-first; shared raw-review cache; scoped MutationObserver; `forceCompare` default false; local AI cache TTL 7d; lazy popup tabs; `npm run analyze`.
- Security: YooKassa webhook verifies payment via API; `price-alert-notify`/`support-notify`/`product-cache`/`check-payment` require JWT; product-intel ignores client `isPremium`/`userId`; marketplace URL allowlist; cron auth on search-alerts/weekly-metrics-digest; narrow Supabase host_permission to project ref.
- CWS audit: drop `activeTab`/`tabs`/`windows`/`api.ozon.ru`; Privacy Policy **v2.1** (telemetry account-linked when signed in; fuller AI payload disclosure; Scrappey on live landing).
- Privacy audit **v2.2**: YooKassa email/user id disclosed; search query + support-notify; Telegram disconnect awaits cloud clear; `purge_privacy_ttl_data` + cron script; `docs/ACCOUNT_DELETION.md`.
- A11y: tablist ARIA + arrow keys; TrackedList keyboard rows; icon `aria-label`; Auth/Chat ID labels; SubscriptionModal Escape/focus trap; contrast/focus tokens; landing skip link; page-panel focus.
- Release assets: brand icons (teal shield); 5× CWS screenshots in `docs/store-assets/`; `docs/RELEASE_GO.md`.

---

## Earlier

История до 2.20.8 велась в коммитах и релизных заметках в чате; с этой версии — единый `CHANGELOG.md`.
