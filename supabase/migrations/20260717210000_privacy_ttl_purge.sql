-- Privacy TTL purge: physical delete for cache / threads / telemetry windows.
-- Applied via migration; schedule with supabase/scripts/setup-privacy-purge-cron.sql
-- or call SELECT public.purge_privacy_ttl_data(); from SQL Editor / cron.

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

  return jsonb_build_object(
    'ok', true,
    'telegram_ai_threads', deleted_threads,
    'product_cache', deleted_product_cache,
    'price_scrape_cache', deleted_scrape_cache,
    'ai_request_log', deleted_ai_logs,
    'search_metrics', deleted_search_metrics,
    'ran_at', now()
  );
end;
$$;

revoke all on function public.purge_privacy_ttl_data() from public;
grant execute on function public.purge_privacy_ttl_data() to service_role;

comment on function public.purge_privacy_ttl_data() is
  'Privacy retention: purge expired Telegram AI threads, stale product/scrape caches, 90d telemetry logs.';
