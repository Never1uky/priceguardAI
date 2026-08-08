-- Stage G (Phase 10): extend purge_privacy_ttl_data() to cover the three
-- gaps identified in docs/architecture/DATA_RETENTION.md that have a
-- technically-derivable (not purely arbitrary) retention window:
--
-- 1. edge_request_log — sliding-window rate limiter (_shared/edge-rate-limit.ts).
--    Coded default window is 60 min (reviews-fetch, REVIEWS_FETCH_RATE_LIMIT_WINDOW_MIN
--    env-overridable) / 1 min (seo-pages). 72h retention gives large safety
--    margin above any realistic window value; rows older than that have no
--    remaining rate-limit function.
--
-- 2. mapping_moderation_events — dispute/reportFail cooldown
--    (cross-market-map/index.ts:355 reads a hard-coded 24h lookback: 
--    `since = now() - 24h`). 48h retention doubles that as safety margin.
--
-- 3. telemetry_events — confirmed write-only from application code
--    (only telemetry-ingest/index.ts inserts; no function reads it back).
--    No code-derived window exists here, unlike the two above — 90 days is
--    chosen for consistency with the existing precedent already set by
--    ai_request_log / search_metrics (same "diagnostics log, manual/dashboard
--    inspection only" shape), not derived from a specific query window.
--    Flagging this distinction explicitly rather than presenting it as
--    equally well-justified as #1/#2.
--
-- cross_market_mapping (Stage E) is intentionally NOT included yet — its TTL
-- depends on the "user-confirmed high-confidence mapping" policy question
-- still open from Stage C, not yet decided.
--
-- Not applied to production by this session — requires `supabase db push`
-- or a manual SQL Editor run on your side.

create or replace function public.purge_privacy_ttl_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_threads bigint := 0;
  deleted_product_cache bigint := 0;
  deleted_scrape_cache bigint := 0;
  deleted_ai_logs bigint := 0;
  deleted_search_metrics bigint := 0;
  deleted_telegram_sessions bigint := 0;
  deleted_edge_request_log bigint := 0;
  deleted_mapping_moderation_events bigint := 0;
  deleted_telemetry_events bigint := 0;
begin
  delete from public.telegram_ai_threads
  where expires_at < now();
  get diagnostics deleted_threads = row_count;

  delete from public.product_cache
  where last_updated < now() - interval '7 days';
  get diagnostics deleted_product_cache = row_count;

  delete from public.price_scrape_cache
  where fetched_at < now() - interval '2 hours';
  get diagnostics deleted_scrape_cache = row_count;

  delete from public.ai_request_log
  where created_at < now() - interval '90 days';
  get diagnostics deleted_ai_logs = row_count;

  delete from public.search_metrics
  where created_at < now() - interval '90 days';
  get diagnostics deleted_search_metrics = row_count;

  delete from public.telegram_product_sessions
  where updated_at < now() - interval '30 days';
  get diagnostics deleted_telegram_sessions = row_count;

  delete from public.edge_request_log
  where created_at < now() - interval '72 hours';
  get diagnostics deleted_edge_request_log = row_count;

  delete from public.mapping_moderation_events
  where created_at < now() - interval '48 hours';
  get diagnostics deleted_mapping_moderation_events = row_count;

  delete from public.telemetry_events
  where created_at < now() - interval '90 days';
  get diagnostics deleted_telemetry_events = row_count;

  return jsonb_build_object(
    'ok', true,
    'telegram_ai_threads', deleted_threads,
    'product_cache', deleted_product_cache,
    'price_scrape_cache', deleted_scrape_cache,
    'ai_request_log', deleted_ai_logs,
    'search_metrics', deleted_search_metrics,
    'telegram_product_sessions', deleted_telegram_sessions,
    'edge_request_log', deleted_edge_request_log,
    'mapping_moderation_events', deleted_mapping_moderation_events,
    'telemetry_events', deleted_telemetry_events,
    'ran_at', now()
  );
end;
$$;

comment on function public.purge_privacy_ttl_data() is
  'Privacy retention: purge expired Telegram AI threads, stale product/scrape caches, '
  '90d ai/search/telemetry logs, Telegram product-session pointers idle 30+ days, '
  '72h rate-limit log, 48h mapping-moderation cooldown log. '
  'cross_market_mapping intentionally not yet covered — see docs/architecture/DATA_RETENTION.md.';
