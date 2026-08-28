# MVIDEO-2 — Default-on «Где искать» (М.Видео)

**Date:** 2026-08-27  
**Status:** done  
**Out of scope:** Telegram, `monitoring_enabled`, Scrappey unlocker, SEO publish, identity `mv-`.

## Change

| Item | Before | After |
|------|--------|--------|
| `registry` `enabledByDefault` | `false` | **`true`** |
| Capabilities | `TEST_MP_CAPS` | `{ search, card, reviews: false, costTier: 'tab' }` |
| `DEFAULT_SEARCH_MARKETPLACE_IDS` | trio + Mega + Ali | + **mvideo** |
| `TEST_MARKETPLACE_IDS` | included mvideo | mvideo **removed** (remaining: dns, citilink, lamoda) |
| Settings copy | Mega+Ali defaults | М.Видео listed among defaults; TG/monitoring still off |
| DB `marketplace_flags` | `marketplace_enabled=false` | **`true`**, `monitoring_enabled=false` (`20260827190000_mvideo_marketplace_enabled.sql`) |
| Saved user selection | unchanged | **not** auto-injected into existing saved lists (`normalize` keeps saved list) |

## Policy still OFF

- Scrappey / `PREMIUM_UNLOCKER` — mvideo excluded (MVIDEO-3 RFC later)
- Server `monitoring_enabled=false` — do not flip
- SEO `publishAllowed=false` — MVIDEO-8 later

## Tests

```bash
npx vitest run src/lib/marketplaces/search-settings.test.ts src/lib/marketplaces/test-mp-urls.test.ts src/lib/compare-offers.marketplaces.test.ts src/utils/parsers/mvideo.test.ts src/lib/mega-core-parity.regression.test.ts src/lib/ali-core-parity.regression.test.ts
```

## Manual smoke

1. New / empty extension storage → Settings «Где искать»: М.Видео **checked** with WB/Ozon/YM/Mega/Ali.  
2. Existing profile that saved only trio → mvideo **not** force-added until reset/empty.  
3. Opt-out mvideo → save → reload → stays off.  
4. Compare runs include mvideo slot when default selected.  
5. Confirm no Telegram / monitoring for mvideo; server flag compare-on.

## Next

Wait for user OK → **MVIDEO-3** (cost RFC / unlocker) or skip to **MVIDEO-4/6** per plan.
