-- Extend purge_privacy_ttl_data() with search_results_cache (6h SERP cache).
-- Body copied from 20260808110000_purge_edge_logs_and_telemetry.sql plus one DELETE.
-- agent_searches is intentionally NOT purged — user-owned search history (Stage 9).

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
  deleted_search_results_cache bigint := 0;
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

  delete from public.search_results_cache
  where fetched_at < now() - interval '6 hours';
  get diagnostics deleted_search_results_cache = row_count;

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
    'search_results_cache', deleted_search_results_cache,
    'ran_at', now()
  );
end;
$$;

comment on function public.purge_privacy_ttl_data() is
  'Privacy retention: purge expired Telegram AI threads, stale product/scrape caches, '
  '90d ai/search/telemetry logs, Telegram product-session pointers idle 30+ days, '
  '72h rate-limit log, 48h mapping-moderation cooldown log, 6h search_results_cache. '
  'agent_searches and cross_market_mapping intentionally not covered — see docs/architecture/DATA_RETENTION.md.';
