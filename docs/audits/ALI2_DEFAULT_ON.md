# ALI-2 — Default-on «Где искать» (AliExpress)

**Date:** 2026-08-27  
**Status:** done  
**Out of scope:** Telegram, `monitoring_enabled`, Scrappey unlocker, SEO publish, identity `ae-`.

## Change

| Item | Before | After |
|------|--------|--------|
| `registry` `enabledByDefault` | `false` | **`true`** |
| `DEFAULT_SEARCH_MARKETPLACE_IDS` | trio + Mega | trio + Mega + **Ali** |
| `TEST_MARKETPLACE_IDS` | included Ali | Ali **removed** (remaining: mvideo, dns, citilink, lamoda) |
| Settings copy | Mega as last default | Ali listed among defaults; TG/monitoring still off for Mega+Ali |
| Saved user selection | unchanged | **not** auto-injected into existing trio-only saves (`normalize` keeps saved list) |

## Policy still OFF

- Scrappey / `PREMIUM_UNLOCKER` — Ali excluded (ALI-3 RFC later)
- `skipsTelegramAlertsForMarketplace` — Mega only until ALI-6
- Server seed `monitoring_enabled=false` for Ali — do not flip

## Tests

```bash
npx vitest run src/lib/marketplaces/search-settings.test.ts src/lib/marketplaces/test-mp-urls.test.ts src/lib/compare-offers.marketplaces.test.ts src/utils/parsers/aliexpress.test.ts src/lib/mega-core-parity.regression.test.ts
```

## Manual smoke

1. New / empty extension storage → Settings «Где искать»: Ali **checked** with WB/Ozon/YM/Mega.  
2. Existing profile that saved only trio → Ali **not** force-added until reset/empty.  
3. Opt-out Ali → save → reload → stays off.  
4. Compare runs include Ali slot when default selected.  
5. Confirm no Telegram / monitoring for Ali.

## Next

ALI-3 cost RFC (unlocker) or ALI-6 `ae-` identity — await user choice.
