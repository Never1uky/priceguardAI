-- Phase 11: expand telemetry_events marketplace allowlist + ops query index.

alter table public.telemetry_events
  drop constraint if exists telemetry_events_marketplace_check;

alter table public.telemetry_events
  add constraint telemetry_events_marketplace_check check (
    marketplace is null
    or marketplace in (
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo',
      'dns',
      'citilink',
      'lamoda'
    )
  );

create index if not exists telemetry_events_name_created_at_idx
  on public.telemetry_events (name, created_at desc);

comment on table public.telemetry_events is
  'Extension opt-in + server operational telemetry (no PII in ops payloads).';
