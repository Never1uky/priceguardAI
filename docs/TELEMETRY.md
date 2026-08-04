# Telemetry — PriceGuard AI

Local event ring + opt-in remote WARN/ERROR. No prompts, emails, or tokenized URLs.

## API

```ts
import { telemetry, setTelemetryContext, newTraceId } from '@/lib/telemetry';

telemetry.info({ stage: 'search', name: 'SEARCH_STARTED', marketplace: 'ozon' });
telemetry.warn({ stage: 'match', name: 'PRODUCT_MATCH_REJECTED', errorCode: 'brand' });
telemetry.error({ stage: 'job', name: 'JOB_ERROR', error });
```

## Modes (Settings → Диагностика, **developer only**)

| Mode | Stores |
|------|--------|
| **verbose** | all levels |
| **normal** (default) | WARN/ERROR always; INFO ~10% sample |
| **silent** | ERROR only |

Обычным пользователям панель телеметрии скрыта. Support path: Настройки → Конфиденциальность → **Скачать отчёт для поддержки** (`diagnostics.json`).

## Storage

- Ring: `chrome.storage.local` key `priceguard_telemetry_ring_v1` (≤400 events, soft ~450KB)
- Settings: `priceguard_telemetry_settings` (`mode`, `remoteEnabled`)
- Session id: `chrome.storage.session`

## Remote (opt-in)

When **Отправлять WARN/ERROR в облако** is on:

1. Events enqueue locally
2. Batch POST → Edge `telemetry-ingest` → table `telemetry_events`
3. Fallback: legacy `search-metrics` for marketplace-tagged events

Also: each search `FINAL_RESULT` soft-writes `search-metrics` (success/latency) without requiring opt-in — same as historical product metrics (query truncated).

## Diagnostics package

- **Users:** Settings → Конфиденциальность → **Скачать отчёт для поддержки**
- **Developer:** Settings → Диагностика (dev) → Copy / Export

Содержимое: last searches / parser / AI / network / edge failures, last ≤200 ring events (без stacks), pipeline counters, version, session id.

## Privacy

Never logged: AI prompt text, passwords, tokens, emails.  
Queries: hashed (`queryHash`) or truncated. URLs: origin+path only.

## Deploy

```bash
npx supabase db push
npx supabase functions deploy telemetry-ingest search-metrics --project-ref ihlfvpocwobvcpxbypsd
```

Migration: `20260724150000_telemetry_events.sql`
