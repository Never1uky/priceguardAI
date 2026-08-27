# MEGA-6 — Client tracked / My Products (no Telegram)

**Date:** 2026-08-26  
**Out of scope:** `monitoring_enabled`, Telegram bots, `update-prices` cron.

## Gaps closed

| Path | Before | After |
|------|--------|--------|
| Cloud pull `tracked-sync` | Mega → `yandex-{id}` + YM URL | `mm-{goodsId}` + `megamarket.ru/catalog/details/…` |
| Client refresh vs cron | Mega skipped until 8h stale when `server_monitoring` on | Mega **always** client-refreshed (cron never scrapes Mega) |
| Compare backup | Fresh CORE compare skipped entirely | Refresh if Mega source or Mega bound URL |
| Alerts | Chrome OK; TG could fire for Mega | Chrome/local UI only for Mega — **no Telegram** |
| My Products «включить оповещения» from compare | Mega got `yandex-` id | `stableProductStorageId` → `mm-` |

Refresh order (unchanged per MEGA-3/4): shared cache → HiddenBrowser tab → Premium unlocker on **manual** force only.

## Manual checklist

1. Open Mega card → popup **Добавить в Мои товары** (or track). Row appears with Мегамаркет badge, title, price, canonical `megamarket.ru` URL.  
2. Reload extension / pull cloud (signed-in): same Mega SKU stays Mega, **not** Я.Маркет.  
3. Change price (or wait) → **Обновить цены** (`CHECK_PRICES_NOW`): price updates in My Products; Chrome notification if drop + alerts on.  
4. With Telegram monitoring **on** (CORE cron): Mega still refreshes from the client; **no** Mega Telegram push.  
5. Compare with Mega selected + bound Mega URL: refresh updates Mega slot; cheaper-elsewhere shows Chrome, not TG.  
6. Untrack Mega: row gone locally; cloud tombstone if signed in.

## Deploy

Client zip is enough for most of MEGA-6. Optional: redeploy `tracked-sync` so Edge `bareTrackedProductId` strips Mega prefixes (`mm-` / non-digits) on push.

```bash
npx supabase functions deploy tracked-sync --project-ref ihlfvpocwobvcpxbypsd
```

Do **not** set `monitoring_enabled` or add Mega to `monitoring_marketplaces`.
