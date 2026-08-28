# Deploy checklist — Mega / Ali / M.Video stack + ops telemetry

**Date:** 2026-08-28  
**Prod:** Supabase `ihlfvpocwobvcpxbypsd`  
**Ops UI:** https://priceguard-landing.vercel.app/ops (repo **`priceguard-landing`**, not this repo)

Prod migration audit: [`PROD_MIGRATION_STATUS_2026-08-28.md`](./PROD_MIGRATION_STATUS_2026-08-28.md)

---

## 0. Preconditions

- [ ] Commit + push local work so deploy matches git (see §1).
- [ ] Do **not** re-run MCP migrations already on prod (§2 in prod audit).
- [ ] Extension zip for QA: `npm run package:zip` → note absolute path.

---

## 1. Git — push order

### 1a. Already committed locally, **not on GitHub** (+2 commits)

| Commit | Content |
|--------|---------|
| `20c3056` | AliExpress READY (card → SEO), Mega docs, Phase 11–12 telemetry base, Economics in `metrics-dashboard` |
| `779927e` | Bump 0.9.123 |

```bash
git push origin main
```

### 1b. Uncommitted — must stage before push

**M.Video product (MVIDEO-1…9)**

| Path | Role |
|------|------|
| `src/utils/parsers/mvideo.ts`, `mvideo.test.ts` | Card + SERP |
| `src/lib/marketplaces/registry.ts`, `adapter-config.ts`, `search-settings.ts` | Default-on, dual host |
| `src/lib/price-identity.ts`, `tracked-client-refresh.ts`, `storage-local.ts` | `mv-` identity |
| `src/lib/premium-unlocker-offer.ts`, `product-page-fetch.cache.test.ts` | Unlocker + cache |
| `src/lib/supabase/compare-research.ts`, `tracked-sync.ts` | Edge client |
| `src/lib/seo/seo-marketplaces.ts`, `publish-gates.test.ts` | SEO allowlist |
| `src/lib/mvideo-core-parity.regression.test.ts` | MVIDEO-9 matrix |
| `src/lib/supabase/tracked-sync.mvideo.test.ts` | tracked-sync tests |
| `supabase/functions/_shared/marketplace-search-core.ts` | compare-research SERP |
| `supabase/functions/_shared/price-scrape-cache.ts`, `product-id.ts`, `product-url.ts` | Cache + identity |
| `supabase/functions/_shared/seo-marketplaces.ts`, `seo-publish-run.ts` | SEO Edge |
| `supabase/functions/compare-research/index.ts` | VALID + mvideo |
| `supabase/functions/fetch-product-price/index.ts`, `price-cache/index.ts` | Cache R/W |
| `supabase/functions/tracked-sync/index.ts` | tracked CHECK |
| `supabase/migrations/20260827190000_mvideo_marketplace_enabled.sql` | flags seed |
| `supabase/migrations/20260827191000_mvideo_scrappey_allowlist.sql` | Scrappey card |
| `supabase/migrations/20260827192000_mvideo_price_scrape_cache.sql` | cache CHECK |
| `supabase/migrations/20260827193000_mvideo_tracked_check.sql` | tracked CHECK |
| `supabase/migrations/20260828100000_mvideo_seo_publish.sql` | SEO CHECK |
| `docs/audits/MVIDEO*.md`, `MVIDEO_FULL_INTEGRATION_NO_TELEGRAM.md` | Audits |
| `package.json` | `test:mvideo` script |
| `manifest.json`, `CHANGELOG.md` | Version / notes |

**Multi-MP ops Reliability (Mega/Ali — local delta on top of Ali commit)**

| Path | Role |
|------|------|
| `src/lib/telemetry/flush.ts`, `flush.test.ts` | `SEARCH_METRICS` Mega/Ali |
| `src/admin/MetricsDashboard.tsx` | Reliability 24h table (5 MPs) |
| `src/lib/supabase/metrics-dashboard.ts` | Client types `searchSuccessRate24h` |
| `supabase/functions/metrics-dashboard/index.ts` | `vw_search_success_rate_24h` |
| `supabase/functions/search-alerts/index.ts` | Multi-MP cron |
| `supabase/functions/search-metrics/index.ts` | VALID 5 MPs |
| `supabase/functions/_shared/search-success-alerts.ts`, `.test.ts` | Alert logic |
| `supabase/migrations/20260827180000_search_metrics_mega_ali.sql` | DB CHECK |
| `supabase/migrations/20260827181000_search_success_rate_24h_multi_mp.sql` | View |
| `docs/audits/SEARCH_METRICS_MEGA_ALI.md`, `SEARCH_SUCCESS_ALERTS_MULTI_MP.md` | Docs |
| `docs/TELEMETRY.md`, `docs/SUPABASE.md` | Operator docs |

**Also modified (push with MP stack):** shared parsers, compare, telemetry funnel, cost-guards, monitoring-key, SettingsTab, etc. — run `git status` before commit.

---

## 2. Supabase DB migrations

**Status:** All rows in §2 of [`PROD_MIGRATION_STATUS_2026-08-28.md`](./PROD_MIGRATION_STATUS_2026-08-28.md) are **already applied** on prod.

| Action | When |
|--------|------|
| `supabase db push` / MCP apply | **Only** for new migrations (MVIDEO-10+) |
| Verify drift | Compare CHECK defs if unsure |

**Do not re-apply:** mvideo_*, search_metrics_mega_ali, search_success_rate_24h_multi_mp (already live).

---

## 3. Supabase Edge — deploy by function

Deploy from **committed** tree after push. Shared `_shared/*` ride along with each function.

### 3a. Already likely current on prod — redeploy only if git diff

| Function | Shared deps | Verify |
|----------|-------------|--------|
| `compare-research` | `marketplace-search-core.ts` | mvideo in VALID |
| `fetch-product-price` | `price-scrape-cache.ts`, `marketplace-prices.ts` | mvideo cache |
| `price-cache` | `price-scrape-cache.ts` | mvideo VALID |
| `tracked-sync` | `tracked-upsert.ts`, `product-id.ts` | mv- prefix |
| `seo-publish` | `seo-marketplaces.ts`, `seo-publish-run.ts` | mvideo publishAllowed |
| `seo-refresh-offers` | `seo-marketplaces.ts` | mvideo offers |
| `telemetry-ingest` | `ops-telemetry.ts` (via ingest) | mvideo allowlist |

```bash
npx supabase functions deploy compare-research fetch-product-price price-cache tracked-sync seo-publish seo-refresh-offers telemetry-ingest --project-ref ihlfvpocwobvcpxbypsd
```

### 3b. Ops / Reliability — required for `/ops` **data** (prod v41/v38 likely OK)

| Function | Key files |
|----------|-----------|
| `metrics-dashboard` | `metrics-dashboard/index.ts`, `_shared/search-success-alerts.ts`, `_shared/economics-dashboard.ts`, `_shared/ops-telemetry.ts` |
| `search-alerts` | `search-alerts/index.ts`, `_shared/search-success-alerts.ts` |
| `search-metrics` | `search-metrics/index.ts` (5 MPs) |

```bash
npx supabase functions deploy metrics-dashboard search-alerts search-metrics --project-ref ihlfvpocwobvcpxbypsd
```

### 3c. MVIDEO-10 (after phase lands)

Same trio + client `flush.ts`; migration widens CHECK + view. See `MVIDEO10_TELEMETRY.md`.

---

## 4. Landing `/ops` — **separate repo**

| Item | Detail |
|------|--------|
| Repo | `priceguard-landing` (Vercel) |
| UI source | Copy/sync `src/admin/MetricsDashboard.tsx` + `src/lib/supabase/metrics-dashboard.ts` (and deps: auth, developer-access, UI components) |
| Env | Same Supabase URL + anon key; user in `METRICS_ADMIN_EMAILS` |
| Deploy | Vercel redeploy **production** after syncing files |

**Why `/ops` looked unchanged:** Edge `metrics-dashboard` v41 already returns multi-MP + Economics; **landing bundle** was not redeployed with updated `MetricsDashboard.tsx`.

Checklist:

- [ ] Sync MetricsDashboard + metrics-dashboard client from `priceguard-ai` @ commit with Reliability table
- [ ] `vercel deploy --prod` (or push to landing main)
- [ ] Login on `/ops` → see **Economics — monitoring** + **Reliability — поиск 24h** (5 rows)
- [ ] Rows show zeros until extension traffic hits `search_metrics`

---

## 5. Extension artifact

| Step | Command / output |
|------|------------------|
| Build + zip | `npm run package:zip` |
| QA | Load unpacked zip in Chrome |
| CWS / sideload | Upload when ready — **users on old build → no mvideo / no new metrics** |

Current local artifact (post MVIDEO-9): `priceguard-ai-v0.9.140.zip` in repo root.

---

## 6. External mirrors

| Repo | Files | When |
|------|-------|------|
| `priceguard-seo` | `src/lib/seo-marketplaces.ts` | After MVIDEO-8 — mvideo `publishAllowed` |
| `priceguard-landing` | MetricsDashboard stack | After §4 |

---

## 7. Post-deploy verification

### DB

```sql
-- 5 MPs in Reliability (pre MVIDEO-10)
SELECT * FROM vw_search_success_rate_24h ORDER BY marketplace;

-- mvideo cache OK
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.price_scrape_cache'::regclass AND contype = 'c';
```

### Edge

- Logged-in POST `metrics-dashboard` `{ "periodDays": 1 }` → `searchSuccessRate24h` length **5**, `economics` present.

### Extension smoke

1. Compare with mvideo selected → offer / needs_choice  
2. Track mvideo → `mv-{id}` in My Products  
3. DevTools → `search-metrics` POST only for allowed MPs on FINAL_RESULT  

### Ops

1. `/ops` → multi-MP Reliability table  
2. After MVIDEO-10 + extension 0.9.14x → sixth row `mvideo` (when traffic exists)

---

## 8. OUT OF SCOPE (do not deploy as part of this checklist)

- Telegram detect / `/add` for mvideo, megamarket, aliexpress  
- `monitoring_enabled=true` for non-trio MPs  
- `update-prices` cron allowlist beyond trio  
- Fake reviews / weakened SEO gates  
