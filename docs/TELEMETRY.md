# Telemetry — PriceGuard AI

Local event ring + opt-in remote WARN/ERROR **and** product-funnel INFO. No prompts, emails, or tokenized URLs.

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
| **normal** (default) | WARN/ERROR always; INFO ~10% sample (**funnel INFO always stored**) |
| **silent** | ERROR only (**funnel INFO still stored**) |

Обычным пользователям панель режима логов скрыта. Support path: Настройки → Конфиденциальность → **Скачать отчёт для поддержки** (`diagnostics.json`).

## Product funnel

Privacy-safe growth events in `src/lib/telemetry/funnel.ts`. Always written to the local ring (bypass INFO sample). **Remote** only when the user enables **Анонимная аналитика продукта** (`remoteEnabled`).

| Event | Notes |
|-------|--------|
| `extension_installed` | `reason` |
| `extension_started` | popup mount, 1× per browser session |
| `product_card_opened` / `marketplace_page_detected` | marketplace; article fingerprint dedupe 30m |
| `compare_started` | `is_first` once per install |
| `compare_completed` | `outcome`, optional `duration_bucket` |
| `comparison_failed` | `failure_reason` whitelist (`product_not_found` ≠ bug) |
| `compare_rejected` / `match_failed` | matching reject |
| `compare_candidate_selected` / `match_manual_selection` | auto / picker |
| `ai_started` / `ai_analysis_*` | started, completed, failed, cache hit; `provider`, `source` |
| `product_tracking_added` / `removed` | marketplace only |
| `monitoring_refresh` / `_failed` | user refresh paths |
| `telegram_connect_started` / `telegram_connected` / `disconnected` + `telegram_linked` | no chat ids |
| `trial_claimed` / `checkout_started` / `premium_active` / `premium_page_opened` | plan id / source only |

**Payload allowlist:** marketplace enum, success, failure_reason, result_type, provider, source (`cache`\|`generate`), duration_bucket, is_first, plan, reason/outcome/ok/mode/cache. Session id and ext version are on the event envelope.

**Never:** URL, title, reviews, product_id, cookies, email, Telegram text, AI prompt/response, payment PAN, license keys.

## Storage

- Ring: `chrome.storage.local` key `priceguard_telemetry_ring_v1` (≤400 events, soft ~450KB)
- Settings: `priceguard_telemetry_settings` (`mode`, `remoteEnabled`)
- Session id: `chrome.storage.session`

## Remote (opt-in)

When **Анонимная аналитика продукта** / cloud toggle is on (`remoteEnabled`):

1. WARN/ERROR and funnel INFO enqueue locally
2. Batch POST → Edge `telemetry-ingest` → table `telemetry_events` (funnel payloads stripped server-side; `product_id` null for funnel)
3. Fallback: legacy `search-metrics` for non-funnel marketplace-tagged events only

Also: each search `FINAL_RESULT` soft-writes `search-metrics` (success/latency) without requiring opt-in — reliability metrics, not product funnel.

Ops dashboard (`/ops`) section **PRODUCT FUNNEL** aggregates funnel rows via `metrics-dashboard` for 1/7/30d. Does not replace Reliability / Scrappey / Edge AI token cards.

## Diagnostics package

- **Users:** Settings → Конфиденциальность → **Скачать отчёт для поддержки**
- **Developer:** Settings → Диагностика (dev) → Copy / Export

Содержимое: last searches / parser / AI / network / edge failures, last ≤200 ring events (без stacks), pipeline counters, version, session id.

## Privacy

Never logged: AI prompt text, passwords, tokens, emails, product URLs/titles in funnel.  
Queries (non-funnel): hashed (`queryHash`) or truncated. URLs: origin+path only.

**REQUIRES MANUAL PRIVACY POLICY UPDATE** before marketing remote product analytics as default — see draft in `docs/audits/growth/P0.1_FUNNEL_TELEMETRY_DESIGN.md`. Policy HTML is not edited by this change; remote funnel remains opt-in.

CWS Data Use: mention optional anonymous product analytics when the user enables the setting.

## Deploy

```bash
npx supabase functions deploy telemetry-ingest metrics-dashboard --project-ref ihlfvpocwobvcpxbypsd
```

Migration: `20260724150000_telemetry_events.sql` (existing table; no new migration required for P1.1).
