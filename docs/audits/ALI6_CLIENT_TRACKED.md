# ALI-6 — Client tracked / My Products (no Telegram)

**Date:** 2026-08-27  
**Out of scope:** `monitoring_enabled`, Telegram bots, `update-prices` cron.

## Gaps closed

| Path | Before | After |
|------|--------|--------|
| Cloud pull `tracked-sync` | Ali → `aliexpress-{id}` fallback | `ae-{itemId}` + `aliexpress.ru/item/{id}.html` |
| Client refresh vs cron | Ali already client-only via `!isCron…` | Explicit Ali cases; always client-refreshed |
| Compare backup | — | Refresh if Ali source or Ali bound URL |
| Alerts | Chrome OK; TG could fire for Ali | Chrome/local UI only for Ali — **no Telegram** |
| My Products from compare | fallback `aliexpress-` | `stableProductStorageId` → `ae-` |

Refresh order (unchanged per ALI-3/4): shared cache → HiddenBrowser tab → Premium unlocker on **manual** force only.

## Manual checklist

1. Open Ali card → popup **Добавить в Мои товары** (or track). Row appears with AliExpress badge, title, price, canonical `aliexpress.ru/item/…` URL, local id `ae-…`.  
2. Reload extension / pull cloud (signed-in): same Ali SKU stays AliExpress, **not** Я.Маркет.  
3. Change price (or wait) → **Обновить цены** (`CHECK_PRICES_NOW`): price updates in My Products; Chrome notification if drop + alerts on.  
4. With Telegram monitoring **on** (CORE cron): Ali still refreshes from the client; **no** Ali Telegram push.  
5. Compare with Ali selected + bound Ali URL: refresh updates Ali slot; cheaper-elsewhere shows Chrome, not TG.  
6. Untrack Ali: row gone locally; cloud tombstone if signed in.

## Deploy

```bash
# Migration (tracked_products + product_price_history CHECK)
# File: supabase/migrations/20260827140000_aliexpress_tracked_check.sql

npx supabase functions deploy tracked-sync --project-ref ihlfvpocwobvcpxbypsd
```

Do **not** set `monitoring_enabled` or add Ali to `monitoring_marketplaces`.
