# SEO marketplace rollout

**Status:** allowlist wired; WB / Ozon / YM / **Megamarket** / **AliExpress** may publish when gates pass.  
**Source of truth:** [`src/lib/seo/seo-marketplaces.ts`](../src/lib/seo/seo-marketplaces.ts)  
**Mirrors (keep in sync):**

- `supabase/functions/_shared/seo-marketplaces.ts` (Edge)
- `priceguard-seo/src/lib/seo-marketplaces.ts` (Next.js site)

Do **not** treat extension [`registry.ts`](../src/lib/marketplaces/registry.ts) as SEO enablement — compare can opt-in to tab MPs while SEO stays narrower.

---

## Order (required)

1. **Adapter READY** — stable card price (not only empty SERP), acceptable false-match rate.
2. **Registry** — MP already in extension `MARKETPLACES` / compare.
3. **SEO allowlist** — add/update entry in `seo-marketplaces.ts` (all three mirrors).
4. Set `publishAllowed: true` (and usually `offersAllowed: true`) **only** after product decision.
5. **DB** — widen `seo_product_pages.marketplace` CHECK (and `product_cache` / mapping if offers need them).
6. **Edge scrape types** — expand Deno `Marketplace` / `parseProductKey` if publish or offers write those ids.
7. **Publish** — `seo-publish` / refresh will pick up via `seoPublishableIds()` / `seoOffersIds()`.

Never flip `publishAllowed` for an MP with NEEDS FIX adapter or no stable price.  
**Per-page:** `evaluateSeoPublishGates` must still pass (no auto-publish of empty/thin analysis).

---

## Per-MP checklist

| MP | Extension READY | SEO wired (slug/strip) | publishAllowed |
|----|-----------------|------------------------|----------------|
| wildberries | yes | yes | **yes** |
| ozon | yes | yes | **yes** |
| yandex_market | yes | yes | **yes** |
| megamarket | yes (MEGA-1…6) | yes | **yes** (MEGA-8; gates still apply) |
| aliexpress | yes (ALI-1…6) | yes | **yes** (ALI-8; gates still apply) |
| mvideo | test / tab | yes | **no** |
| dns | test / tab | yes | **no** |
| citilink | test / tab | yes | **no** |
| lamoda | test / fashion gate | yes | **no** |

**Extension READY** for SEO publish means: stable card price path, acceptable false-match rate, and an intentional decision to index that MP.

**Megamarket / AliExpress note:** Reviews capability is SKIP (MEGA-7 / ALI-7). Pages typically need `webOverview` ≥ `SEO_MIN_WEB_OVERVIEW_LEN` (or enough reviews later) to clear gates — no fake reviews.

---

## Short slugs

| id | shortSlug |
|----|-----------|
| wildberries | wb |
| ozon | ozon |
| yandex_market | ym |
| megamarket | mm |
| aliexpress | ae |
| mvideo | mvideo |
| dns | dns |
| citilink | citi |
| lamoda | lamoda |

---

## What this pass did / did not

**Done (ALI-8):** Ali `publishAllowed` + `offersAllowed`; DB CHECK `seo_product_pages` + `product_cache` + `cross_market_mapping`; three mirrors synced; gates unchanged.

**Not done:** Telegram / monitoring; Ali reviews; flipping test MPs; CWS listing copy.
