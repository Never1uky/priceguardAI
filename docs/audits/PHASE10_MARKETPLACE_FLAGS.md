# Phase 10 — Marketplace feature flags

Server-side flags separate **manual compare** from **Telegram monitoring**, so a new marketplace can ship in the extension before cron/Scrappey cost is enabled.

## Model

| Flag | Scope | When `false` |
|------|--------|----------------|
| `marketplace_enabled` | Extension compare / search | MP hidden in «Где искать»; not used in compare targets |
| `monitoring_enabled` | Telegram `/add`, `update-prices` cron | No server tracking/scrape for this MP |

Both are **per marketplace** rows in `marketplace_flags`.  
Monitoring also intersects Phase 9 **global allowlist** `monitoring_cost_guards.monitoring_marketplaces`.

```
effective_monitoring(mp) =
  marketplace_flags[mp].monitoring_enabled
  ∧ mp ∈ cost_guards.monitoring_marketplaces
```

Priority: **`MARKETPLACE_FLAGS_JSON` env > DB > code defaults**.

## Defaults (seed migration)

| MP | compare | monitoring |
|----|---------|------------|
| wildberries, ozon, yandex_market | ✓ | ✓ |
| megamarket, aliexpress, mvideo, dns, citilink, lamoda | ✗ | ✗ |

## Compare-only pilot

```sql
update public.marketplace_flags
set marketplace_enabled = true,
    monitoring_enabled = false,
    note = 'compare-only pilot',
    updated_at = now()
where marketplace_id = 'megamarket';
```

Users can opt in locally; Telegram `/add` for Megamarket still returns «мониторинг отключён».

## Components

| Layer | Path |
|-------|------|
| DB | `marketplace_flags` — migration `20260826003000_marketplace_flags.sql` |
| Shared | `supabase/functions/_shared/marketplace-flags.ts` |
| Public API | Edge `marketplace-flags` (GET/POST, no JWT) |
| Cron | `update-prices` — filter coalesced groups |
| Telegram | `telegram-webhook` — `/add` gate |
| Extension | `src/lib/marketplaces/server-flags.ts` + `search-settings.ts` gate |
| UI | `SettingsTab` — «на сервере выкл» for disabled MPs |
| Ops | `supabase/scripts/set-marketplace-flags.sql` |

## Extension client behavior

- Fetches flags via `callEdgeSafe('marketplace-flags')`, caches 1h in `chrome.storage.local`.
- On fetch failure: **conservative** — only core trio allowed for compare.
- User local selection is intersected with server allowlist on read/save.

## Relation to Phase 9

| Phase 9 (`monitoring_cost_guards`) | Phase 10 (`marketplace_flags`) |
|-------------------------------------|--------------------------------|
| Global limits (track cap, freshness, Scrappey kill) | Per-MP on/off |
| `monitoring_marketplaces[]` emergency allowlist | `monitoring_enabled` per MP |
| User cannot override | User cannot override |

Use Phase 9 for **cost emergencies** (disable Scrappey globally, slow cron).  
Use Phase 10 for **product rollout** (new MP in compare first, monitoring later).

## Env

```bash
MARKETPLACE_FLAGS_JSON={"megamarket":{"marketplace_enabled":true,"monitoring_enabled":false}}
```

## Tests

- `supabase/functions/_shared/marketplace-flags.test.ts` — merge, compare-only, env overlay, allowlist intersection
