# MVIDEO-6 — Client tracked / My Products (no Telegram)

**Date:** 2026-08-27  
**Out of scope:** `monitoring_enabled`, Telegram bots, `update-prices` cron, Edge `detectMarketplace` for mvideo.ru / eldorado.ru.

## Gaps closed

| Path | Before | After |
|------|--------|--------|
| Storage id | fallback `mvideo-{article}` | `mv-{article}` (+ strip `mvideo:` / `mv-` / Eldorado URL) |
| Cloud pull `tracked-sync` | mvideo rejected by VALID / CHECK | VALID + CHECK; reconstruct keeps host (mvideo vs eldorado) |
| Client refresh vs cron | inherited non-cron | Explicit mvideo cases; always client-refreshed |
| Compare backup | — | Refresh if mvideo source or mvideo bound URL |
| Alerts | Chrome OK; TG could fire | Chrome/local UI only for mvideo — **no Telegram** |
| My Products from compare | fallback `mvideo-` | `stableProductStorageId` → `mv-` |

Refresh order (unchanged per MVIDEO-3/4): shared cache → HiddenBrowser tab → Premium unlocker on **manual** force only.

## Manual checklist

1. Open M.Video / Eldorado card → popup **Добавить в Мои товары**. Row: М.Видео badge, title, price, canonical URL (host preserved), local id `mv-…`.  
2. Reload extension / pull cloud (signed-in): same SKU stays М.Видео, **not** Я.Маркет.  
3. Change price (or wait) → **Обновить цены** (`CHECK_PRICES_NOW`): price updates; Chrome notification if drop + alerts on.  
4. With Telegram monitoring **on** (CORE cron): mvideo still refreshes from the client; **no** mvideo Telegram push.  
5. Compare with mvideo selected + bound URL: refresh updates mvideo slot; cheaper-elsewhere shows Chrome, not TG.  
6. Untrack mvideo: row gone locally; cloud tombstone if signed in.

## Deploy

```bash
# Migration (tracked_products + product_price_history CHECK)
# File: supabase/migrations/20260827193000_mvideo_tracked_check.sql

npx supabase functions deploy tracked-sync --project-ref ihlfvpocwobvcpxbypsd
```

Do **not** set `monitoring_enabled` or add mvideo to `monitoring_marketplaces`.  
Do **not** add mvideo to Edge `detectMarketplace` (Telegram `/add` stays OFF).
