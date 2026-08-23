# P1.2–P1.4 — SEO quality, price table, indexing

**Дата:** 2026-08-20 (offers ops recheck ~22:30 MSK)  
**Репо:** `priceguard-seo` (Next ISR), `priceguard-landing` (Vite SPA), Edge в `priceguard-ai`  
**Статус:** P1.2 **AUDITED** · P1.3 **UI DONE** · P1.4 indexing = MANUAL (владелец) · offers ops **PASS** (6/6 real SKU; 2/6 = 2 MP; 4/6 YM-only = WEAK; cron **active**)

## Architecture (ALREADY IMPLEMENTED)

| Piece | Location | Notes |
|-------|----------|-------|
| Pages `/a/[slug]` | `priceguard-seo/src/app/a/[slug]/page.tsx` | ISR `revalidate`, top-N static params |
| Durable store | `seo_product_pages` + Edge `seo-pages` | published only |
| Publish | `seo-publish` (no AI on refresh) | |
| Offers refresh | `seo-refresh-offers` Edge | copies `price_scrape_cache` + `cross_market_mapping` → `offers_snapshot`. **No live scrape on pageview.** |
| Cron | `pg_cron` job `priceguard-seo-refresh-offers` | **ACTIVE** `30 */6 * * *` UTC (+30m after `update-prices`) |
| Sitemap / robots | `sitemap.xml/route.ts`, `robots.txt` | SEO app OK |
| JSON-LD | Product + Breadcrumb + FAQ | `json-ld.ts` — Product only when `offers` or honest `aggregateRating` (GSC fix 2026-08-23) |
| Canonical | `SEO_SITE_ORIGIN + /a/{slug}` | still `*.vercel.app` |
| CTA | `compare-cta.tsx` → `SEO_OPEN_COMPARE` | no forced MP deep-link required |
| Extension bridge | `src/lib/seo-open-compare.ts` + manifest `externally_connectable` | |

## P1.2 — Priority URL quality pass

Источник slug: `https://priceguard-seo.vercel.app/sitemap.xml` (не выдуманы).

Live check **API** `GET .../functions/v1/seo-pages?slug=` + HTML `/a/{slug}` **2026-08-20 ~22:30 MSK** (после batch `seo-refresh-offers` + Edge revalidate).

| Target | Live URL | Meta/H1 | Offers snapshot (API) | Cache | Verdict |
|--------|----------|---------|----------------------|-------|---------|
| AirPods Pro 3 | [/a/apple-airpods-pro-3](https://priceguard-seo.vercel.app/a/apple-airpods-pro-3) | PASS | 1× YM 20457 ₽ (`4690088798`) | YM ✓ | **WEAK** — YM-only (no honest WB/Ozon bind) |
| Dyson Airwrap Complete Long | [/a/dyson-airwrap-complete-long](https://priceguard-seo.vercel.app/a/dyson-airwrap-complete-long) | PASS | 1× YM 41760 ₽ (`6100327702`, HS08 Vinca Blue/Topaz) | YM ✓ | **WEAK** — YM-only |
| DualSense White | [/a/playstation-dualsense-white](https://priceguard-seo.vercel.app/a/playstation-dualsense-white) | PASS | 2× WB 6033 ₽ (`1137034267`) + YM 7764 ₽ (`4787042645`) | WB+YM ✓ | **PASS** |
| Roborock S8 | [/a/roborock-s8](https://priceguard-seo.vercel.app/a/roborock-s8) | PASS | 1× YM 78027 ₽ (`5740068370`, base S8) | YM ✓ | **WEAK** — YM-only |
| Sony WH-1000XM5 | [/a/sony-wh-1000xm5](https://priceguard-seo.vercel.app/a/sony-wh-1000xm5) | PASS | 2× WB 17810 ₽ (`741076063`) + YM 21787 ₽ (`5676974854`) | WB+YM ✓ | **PASS** |
| Nike Air Force 1 | [/a/nike-air-force-1](https://priceguard-seo.vercel.app/a/nike-air-force-1) | PASS | 1× YM 15300 ₽ (`103566269089`, triple white) | YM ✓ | **WEAK** — YM-only |

Также в sitemap: `apple-airpods-4` (base AirPods). `nike-m-nk-tee` — **другой** товар (футболка), не AF1.

**HTML:** все 6 имеют `data-section="offers"` + dated snapshot (`offers-snapshot-at`). Cap ≤3 MP в UI.

### Offers ops 2026-08-20 (no pageview scrape)

**Root cause (fixed):** 5/6 pages were `seed-*` IDs → refresh had nothing to copy. Rebound to real MP IDs; DualSense kept WB `1137034267` (cache row ensured before refresh — safety).

**Current bindings (no seed-*):**

| slug | product_key | mappings | offer_count |
|------|-------------|----------|-------------|
| playstation-dualsense-white | `wildberries:1137034267` | WB↔YM | 2 |
| sony-wh-1000xm5 | `wildberries:741076063` | WB↔YM | 2 |
| apple-airpods-pro-3 | `yandex_market:4690088798` | — | 1 |
| dyson-airwrap-complete-long | `yandex_market:6100327702` | — | 1 |
| roborock-s8 | `yandex_market:5740068370` | — | 1 |
| nike-air-force-1 | `yandex_market:103566269089` | — | 1 |

**Not mapped (identity, not missing cron):**
- Ozon: anti-bot «нет соединения» from blocked IPs — leave empty until HiddenBrowser/Scrappey **owner-approved** server-side fill (never pageview).
- AirPods WB `972113376` — replica-looking listing.
- Dyson WB `592911783` — HS08 Complete Long but **Ceramic Pink**, not Vinca Blue/Topaz.
- Roborock WB `379663040` — **S8 Pro** ≠ base S8; price sanity fail.
- AF1 WB `1260902121` — absurd price vs YM; replica/wrong product.
- XM5 old YM `5712125537` — dead `/product/`; live card `5676974854`.

**Cron status:**
- **LIVE:** `cron.job` `priceguard-seo-refresh-offers` schedule `30 */6 * * *`, `active=true` (auth cloned from `update-prices`).
- **Local uncommitted (optional GH backup):** `supabase/scripts/setup-seo-refresh-offers-cron.sql`, `.github/workflows/seo-refresh-offers.yml` — **не коммитить** без явной просьбы владельца (SQL уже применён в проекте).
- Batch refresh 2026-08-20: 6/6 `updated=1`, HTTP 200; Edge `notifyRevalidate` → HTML offers visible.

**MANUAL (owner) — подтянуть 2-й MP без bad bind:**
1. На этом ПК: HiddenBrowser / расширение → compare по YM URL четырёх WEAK SKU → запись в `price_scrape_cache` + честный `cross_market_mapping` только при совпадении модели/цвета/цены.
2. Затем `seo-refresh-offers` с `{"slug":"..."}` (или дождаться cron).
3. Не мапить сомнительные WB выше. Scrappey server-side — только если HiddenBrowser не может (Ozon) и владелец явно ок.
4. Если нужен GH backup cron: сказать «закоммить workflow» (секреты уже есть у `update-prices`).

**Do not:** live Scrappey on pageview · mass pages · content/noindex without approve · refresh DualSense when WB cache row missing.

## P1.3 — Price table UI (DONE)

**Current architecture (unchanged):** `offers_snapshot` + cron; **не** live Scrappey на pageview.

**UI polish shipped** (`priceguard-seo`):

- Блок offers: дата/время снимка (`formatDateTimeRu` по `page.updatedAt` / published / analyzed)  
- Cap ≤3 MP (`pickDisplayOffers`)  
- Delta vs cheapest: «самая низкая» / `+N ₽ к минимуму`  
- Disclaimer snapshot сохранён  
- CTA `CompareCta` / `SEO_OPEN_COMPARE` не трогали  

Файлы: `src/lib/offers-ui.ts`, `src/lib/format.ts` (`formatDateTimeRu`), `src/components/analysis-view.tsx`.

## P1.4 — Indexing (MANUAL — владелец)

| Surface | Status | Next |
|---------|--------|------|
| priceguard-seo sitemap/robots | Implemented | Submit sitemap in GSC/Вемастер |
| Custom domain | Missing (vercel.app) | DNS + Search Console property MANUAL |
| Landing robots.txt | Sitemap line vs missing `public/sitemap.xml` | GAP (отдельно) |

### Do not

- Mass-generate hundreds of AI pages  
- Duplicate the same product under many thin slugs  
- Live scrape per pageview  

## Verdict

SEO stack **built**. P1.2 meta/CTA/JSON-LD **OK**. Offers: **no seed-***; DualSense + XM5 **PASS** (WB+YM); four others **WEAK** YM-only (honest — no bad binds). `priceguard-seo-refresh-offers` **pg_cron active**. P1.3 UI **done**. Indexing = P1.4 owner. Next growth lever for offers: HiddenBrowser cache+mapping for WEAK four / Ozon when antibot allows.
