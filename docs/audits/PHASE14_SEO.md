# Phase 14 — SEO marketplace (product/model, not per-seller)

## Verdict

Architecture matches intent: **one public page per product/model** (`/a/{slug}`), marketplace listings as **`offers_snapshot`** inside it. **No SEO page type for sellers.**

Storage is still SKU-keyed (`marketplace:product_id`) with optional **canon collapse** (`canon_id` + `is_primary` + 301).

## Checklist

| Item | Status | Notes |
|------|--------|-------|
| Canonical | OK | Absolute URL; aliases → primary |
| Sitemap | Fixed P0 | Edge already `is_primary`; SEO app service-role now filters + dedupes `canonical_path` |
| Robots | Fixed | Landing sitemap → `priceguard-seo.vercel.app/sitemap.xml` |
| Metadata | OK | title / description / OG / Twitter |
| Structured data | OK | Product + AggregateOffer; seller = marketplace brand |
| Marketplace names | OK | WB/Ozon/YM allowlist (`SEO_MP_ROLLOUT`) |
| Product pages | OK | `/a/[slug]` + offers UI (one offer per MP display) |
| Duplicate pages | Mitigated | Canon + primary + 301; residual if `canon_id` null |
| Same product / sellers | OK intent | Multiple seller SKUs → offers or alias, not new model page |
| Indexing | RISK ops | Host still `*.vercel.app`; GSC manual |
| Price freshness | Fixed P0 | Refresh merges canon peers; batch refreshes **primaries** only |

## Duplicate content

| Risk | Mitigation |
|------|------------|
| WB+Ozon same model | `canon_id` + `is_primary` + redirect |
| Alias in sitemap/hubs | Filter `is_primary=true` (Edge + SEO app) |
| Refresh wiped peer offers | `mergeOffersWithCanonPeers` in `seo-refresh-offers-run` |
| Related linked aliases | `related` / search / brand / category → primaries only |
| Two Ozon seller ids | UI one-per-MP; full merge in snapshot |

## Fixes shipped (this phase)

1. **`seo-refresh-offers-run.ts`** — merge peer offers; skip aliases in cron; sync alias snapshots from primary  
2. **`priceguard-seo` `seo-pages.ts`** — `is_primary` on sitemap / latest / brand / category / search / related; sitemap dedupe by `canonical_path`  
3. **`seo-pages` Edge `related`** — already filtered (verified)  
4. **Landing `robots.txt`** — point Sitemap at SEO origin  

## Residual (P1/P2)

- Harden `buildSeoCanonId` when brand/model weak (still multi-page risk)  
- Prefer attach-as-offer when mapping already points at a primary  
- Custom domain + GSC property  

## Entity model (do not regress)

```
Product/model page  ←── indexed, sitemap, canonical
   └── offers[]     ←── WB / Ozon / YM (and future MPs)
        └── NOT a separate /seller/{id} page
```

Docs: `docs/SEO_PRODUCT_PAGES.md` §2.1a, `docs/SEO_MP_ROLLOUT.md`, `docs/audits/growth/P1_SEO_INDEXING_AND_OFFERS.md`.
