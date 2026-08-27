# SEO product pages — architecture decision & specs

**Status:** approved for implementation  
**Date:** 2026-08-07  
**Chosen variant:** **B (optimal)** — Next.js App Router + ISR + durable `seo_product_pages`  
**Not chosen:** A (landing prerender spike only); C (queues/search cluster — later)

**Multi-MP rollout:** see [`SEO_MP_ROLLOUT.md`](./SEO_MP_ROLLOUT.md) — allowlist, publishAllowed gates, per-MP checklist. Only WB / Ozon / YM publish until a new MP is READY.

---

## 1. Approve: variant + canonical host

| Decision | Value |
|----------|--------|
| Architecture | **Variant B** |
| AI cost | **0** — publish only copies existing `product_cache` v2; never call `ai-proxy` / generate |
| Marketing site | Keep [`priceguard-landing`](https://priceguard-landing.vercel.app) (Vite SPA: offer, privacy, blog) |
| SEO app | New Vercel project / repo app: **`priceguard-seo`** (Next.js App Router) |
| Canonical origin (v1) | `https://priceguard-seo.vercel.app` via env `SEO_SITE_ORIGIN` |
| Future custom domain | Prefer `https://reviews.priceguard.ai` (or apex path) — update `SEO_SITE_ORIGIN` only; slugs unchanged |
| Product URL shape | `{SEO_SITE_ORIGIN}/a/{slug}` |
| Brand / category | `{SEO_SITE_ORIGIN}/brand/{brandSlug}`, `{SEO_SITE_ORIGIN}/category/{categorySlug}` |
| Search | `{SEO_SITE_ORIGIN}/search?q=` |
| Extension / Edge | Unchanged for users; publish hook is fire-and-forget after v2 upsert |

Cross-links: landing footer/nav may link “Анализы” → SEO origin; SEO pages CTA → CWS + landing `#pricing`.

---

## 2. Spec: `seo_product_pages` + quality gates + slug rules

### 2.1 Table DDL (see migration)

Natural key: `(marketplace, product_id)` unique.  
Public URL key: `slug` unique.  
Body of truth for HTML: `analysis_snapshot` (jsonb), **not** live `product_cache` (7d purge).

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `slug` | text unique | URL segment |
| `canonical_path` | text | `/a/{slug}` |
| `marketplace` | text | wildberries \| ozon \| yandex_market |
| `product_id` | text | bare marketplace id |
| `product_key` | text unique | `{marketplace}:{product_id}` |
| `title` | text | |
| `brand` | text null | normalized display |
| `brand_slug` | text null | for `/brand/...` |
| `category` | text null | |
| `category_slug` | text null | for `/category/...` |
| `analysis_snapshot` | jsonb | FullProductAnalysis copy |
| `analysis_hash` | text | sha256 of stable analysis fields |
| `analyzed_at` | timestamptz | from snapshot |
| `offers_snapshot` | jsonb | array of cross-MP offers |
| `price_current` | numeric null | |
| `currency` | text default `RUB` | |
| `image_url` | text null | |
| `product_url` | text null | canonical MP card URL |
| `rating` | numeric null | if known |
| `quality_score` | numeric | scale **0–10** (typically 1–10); UI via `formatQualityScore` |
| `view_count` | int default 0 | honest counter; UI only if ≥10 |
| `view_count_updated_at` | timestamptz null | |
| `review_count` | int default 0 | from `raw_reviews` length at publish |
| `publish_status` | text | `draft` \| `published` \| `rejected` \| `archived` |
| `reject_reason` | text null | |
| `search_vector` | tsvector | title + brand + summary (maintained in publish) |
| `published_at` | timestamptz null | first time → published |
| `updated_at` | timestamptz | |
| `created_at` | timestamptz | |
| `canon_id` | text null | Optional group `canon:brand\|model\|storage\|category` |
| `is_primary` | boolean default true | Main page of a canon group |
| `primary_slug` | text null | Alias → primary slug (redirect/canonical) |

### 2.1a Product vs Offer

- **Product (page):** brand/model/title, `analysis_snapshot` (AI), pros/cons, verdict, characteristics. One primary SEO page per `canon_id` when known.
- **Offer:** marketplace + product id + url + price (+ optional rating) in `offers_snapshot`. Multiple MP / sellers = multiple offers on **one** page — not new SEO rows for the same canon.
- **SKU rows** still use `product_key = {marketplace}:{id}`; aliases keep old URLs and redirect to primary.
- **Images:** optional; do **not** publish marketplace CDN guesses (`wbbasket`, etc.).
- **CTA:** «Открыть в PriceGuard AI» via `externally_connectable` + `SEO_OPEN_COMPARE`; fallback Chrome Web Store. Primary CTA never goes to marketplace card URL.

RLS: enable; **no anon policies on table**. Public reads via Edge `seo-pages` (service role) or Next server with service role. Optional later: `published`-only view + `security_invoker` for anon.

Indexes: `slug`, `product_key`, `brand_slug`, `category_slug`, `publish_status`, `canon_id`, GIN(`search_vector`).

### 2.2 Quality gates (baseline constants)

Module: `seoPublishGates` (pure). Fail → `publish_status = rejected` (or skip insert if never published).

| ID | Rule | Constant |
|----|------|----------|
| `empty_analysis` | missing numeric `qualityScore` OR empty `qualitySummary` OR empty `verdictExplanation` OR invalid `verdict`/`fakeRisk` | — |
| `insufficient_reviews` | `reviewCount < 5` AND `webOverview.trim().length < 80` | `SEO_MIN_REVIEWS = 5`, `SEO_MIN_WEB_OVERVIEW_LEN = 80` |
| `low_quality` | `qualityScore < 6` | `SEO_MIN_QUALITY_SCORE = 6` |
| `local_source` | `source === 'local'` | reject (weak fallback) |
| `thin_content` | `pros.length < 2` OR `cons.length < 1` | P2 |
| `weak_title` | junk / too-short product title | P2 |
| `already_same_hash` | existing row + same `analysis_hash` | no-op success (no write) |

**P2 page UX:** H1/title `{Name} — стоит ли покупать?`; render `webOverview` + `priceInsight`; optional schema v3 `reviewThemes` / `audienceFit` / `audienceAvoid` / `dataGaps`. Cron: `seo-publish` actions `batch-publish`, `metrics`, `backfill-categories`. Sitemap index when URL count > 10k.


Pass → upsert `published` (or keep `draft` if global flag `SEO_AUTO_PUBLISH=false` for moderation — default **true** for auto-publish when gates pass).

### 2.3 Slug rules

1. Extract `brand`, `model`, optional `storage` / year token from `ProductFeatures` / title (reuse feature extractors where possible).
2. If brand+model weak → fallback slug: `{marketplace}-{product_id}` (e.g. `ozon-123456`).
3. `slugify`: NFKD, lower, replace ё→е, non `[a-z0-9]+` → `-`, collapse `-`, trim, max **80** chars.
4. Prefer human slug: `apple-airpods-max-usb-c`.
5. Collision (slug taken by **other** `product_key`): append `-{marketplace short}` (`wb`/`ozon`/`ym`), then `-{product_id}` slice, then numeric `-2`, `-3`.
6. **Never rename** slug on analysis update (stable canonical). Brand/category slugs may update fields but path `/a/{slug}` stays.

`canonical_path` = `/a/{slug}`. Absolute canonical = `SEO_SITE_ORIGIN + canonical_path`.

### 2.4 `analysis_hash`

SHA-256 hex over canonical JSON of:

`qualityScore`, `qualitySummary`, `webOverview`, `pros`, `cons`, `fakeRisk`, `fakeRiskExplanation`, `verdict`, `verdictExplanation`, `keySpecs`, `hiddenProblems`, `alternatives`, `analogComparison`, `source`  

Exclude `priceInsight`, `analyzedAt`, `providerLabel` (soft / noisy).

---

## 3. Spec: publish job (no AI)

### 3.1 Trigger points

After successful **v2** upsert only:

1. [`product-cache-store` put / invalidate paths that write v2](supabase/functions/_shared/product-cache-store.ts) — prefer explicit call from writers
2. End of [`product-intel`](supabase/functions/product-intel/index.ts) generate when analysis saved
3. Extension remote put of full analysis (same Edge put)

**Do not** trigger on v1/v3-only writes.

### 3.2 Algorithm `runSeoPublish(marketplace, productId)`

```
1. Load product_cache v2 for id candidates (prefixed + bare)
2. If missing/stale row optional: still allow if we only refresh offers for existing seo page
3. Parse ai_analysis → FullProductAnalysis; review_count = len(raw_reviews)
4. Load title/image/url/price from cache row + optional price_scrape_cache + mapping offers (no AI)
5. Compute analysis_hash; load existing seo_product_pages by product_key
6. If exists && hash equal → optional offers-only refresh; return { ok, skipped: 'unchanged' }
7. Run gates; if fail:
     - if exists published → leave published content, set reject on draft attempt OR keep last good snapshot
     - if not exists → upsert rejected with reason (or skip row)
8. Build slug if new; keep slug if exists
9. Upsert snapshot, offers_snapshot, denormalized fields, search_vector, publish_status=published
10. Fire on-demand revalidate to Next (HTTP POST /api/revalidate with secret) for path + sitemap
```

### 3.3 Edge surface

| Function | Auth | Role |
|----------|------|------|
| Internal `seo-publish` (or shared called from product-intel) | service / cron secret | run publish |
| `seo-pages` GET by slug / search / brand / category | public or CDN | read **published** only |
| Cron `seo-refresh-offers` | cron secret | refresh offers_snapshot without touching analysis |

**Forbidden:** importing generate path from `ai-proxy`.

### 3.4 Offers snapshot shape

```ts
{
  marketplace: string
  productId: string
  url: string
  title?: string
  price: number | null
  rating?: number | null
}[]
```

From `cross_market_mapping` (active) + `price_scrape_cache` / live scrape already used by product-intel — **reuse**, do not new scrape storms (cap N offers).

### 3.5 Price history (v1)

Do **not** use `product_price_history` (per-user). UI: omit chart or show “история скоро”. Future C: `public_price_series`.

---

## 4. Spec: Next.js ISR routes

App: `priceguard-seo` (Next 15 App Router, Vercel).

### 4.1 Routes

| Route | Behavior |
|-------|----------|
| `/` | Hub: latest published, links to brands/categories/search |
| `/a/[slug]` | Product analysis page — **ISR** `revalidate = 3600`; `generateStaticParams` top N optional |
| `/brand/[brandSlug]` | List published by brand |
| `/category/[categorySlug]` | List published by category |
| `/search` | Server component; `q` → FTS via Edge or direct service-role query |
| `/sitemap.xml` | Index or single sitemap of all `published` `/a/*` + brand/category |
| `/robots.txt` | Allow `/`; sitemap URL; disallow `/api/` |
| `/rss.xml` | Last 50 published by `published_at` |
| `/api/revalidate` | POST secret; revalidate path tags |

### 4.2 Page `/a/[slug]` blocks

1. Breadcrumbs: Главная → Category → Brand → Title  
2. H1 + updated_at  
3. Hero: image, price_current, MP link, verdict badge  
4. Краткий вывод (qualitySummary / verdictExplanation)  
5. Плюсы / минусы  
6. Характеристики (keySpecs)  
7. Анализ отзывов (score, fakeRisk, hiddenProblems)  
8. Где дешевле (offers_snapshot)  
9. Альтернативы (AI text alternatives)  
10. Похожие анализы (same category/brand, limit 6)  
11. JSON-LD Product + BreadcrumbList + FAQPage  
12. CTA install extension (`SITE.chromeStoreUrl` / shared constant — CWS id `ipaichogganccpnapdgkjldplllnjlpf`)

### 4.3 Metadata (server `generateMetadata`)

Deterministic templates — no LLM:

- `title`: `{brand} {model}: отзывы, плюсы и минусы — PriceGuard AI`
- `description`: truncate summary ≤155
- `keywords`: brand, model, category, Ozon, Wildberries, Яндекс Маркет
- `alternates.canonical`: `SEO_SITE_ORIGIN + canonical_path`
- `openGraph` / `twitter`: title, description, images `[image_url]`

### 4.4 FAQ schema sources (templates)

1. Стоит ли покупать? → verdict + verdictExplanation  
2. Есть ли риск накрутки отзывов? → fakeRisk + explanation  
3. Как цена относительно рынка? → priceInsight (if non-empty)  
4. Какие минусы чаще всего? → first 1–2 cons  

### 4.5 Data access

Next server components call Supabase **service role** (server-only env) filtered `publish_status = 'published'`, **or** public Edge `seo-pages` to avoid exposing service key in more places. Prefer Edge read API + CDN cache headers.

### 4.6 Revalidate

On publish upsert: `POST {SEO_SITE_ORIGIN}/api/revalidate` with `SEO_REVALIDATE_SECRET`, body `{ paths: ['/a/'+slug, '/sitemap.xml', '/rss.xml', ...] }`.

---

## 5. Implementation order (after this spec)

1. Migration `seo_product_pages` + RLS — **done** (`20260807220000`)
2. Pure helpers: slugify, hash, gates + unit tests — **done** (`src/lib/seo`, `_shared/seo-*`)
3. Edge `seo-publish` + hook from product-intel / cache put — **done** (`upsertProductCacheVersioned` → `scheduleSeoPublishAfterV2Upsert` fire-and-forget)
4. Edge `seo-pages` read API — **done** (public + IP rate limit; published only)
5. Scaffold `priceguard-seo` Next app with routes above — **done** (`../priceguard-seo`, sibling of landing)  
6. Wire revalidate + robots/sitemap/rss — **done** (in `priceguard-seo`)  
7. Landing link to SEO hub — **done** (`SITE.seoSiteOrigin` in Header/Footer)  
8. Cron `seo-refresh-offers` — **done** (offers/price only, no AI)

### Manual smoke `seo-publish`

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/seo-publish" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"marketplace\":\"ozon\",\"productId\":\"YOUR_ID\"}"
```

### Manual smoke `seo-refresh-offers`

```bash
# batch (stale-first, default limit 40)
curl -sS -X POST "$SUPABASE_URL/functions/v1/seo-refresh-offers" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":10}"

# single slug
curl -sS -X POST "$SUPABASE_URL/functions/v1/seo-refresh-offers" \
  -H "x-cron-secret: $UPDATE_PRICES_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"slug\":\"your-slug\"}"
```

Optional env on Edge: `SEO_SITE_ORIGIN`, `SEO_REVALIDATE_SECRET` (revalidate no-ops if unset).

Suggested pg_cron / external cron: every 6h, same auth as `update-prices`.

---

## 6. Out of scope (unchanged)

- AUTO_PICK / match thresholds / quota / CWS listing copy  
- LLM-generated SEO prose  
- Publishing per-user `product_price_history`  
- Anon RLS on raw `product_cache`
