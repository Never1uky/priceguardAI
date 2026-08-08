-- Stage D (Phase 8): extend purge_privacy_ttl_data() to cover
-- telegram_product_sessions — a per-chat "current product" pointer with no
-- delete path anywhere in the codebase (confirmed via full-repo grep).
--
-- Rationale for the 30-day cutoff (not arbitrary): the table is upserted on
-- every new product link sent to the bot (chat_id is the primary key, one
-- row per chat) and read only to answer "what product are we discussing
-- right now" — a stale row has zero functional value; if the user returns,
-- upsertSession() simply recreates it. 30 days is a generous inactivity
-- window that won't affect any real usage pattern, chosen independently of
-- (and longer than) telegram_ai_threads' 48h, since that table serves a
-- different purpose (short AI conversation context, not a durable pointer).
--
-- This migration only redefines the existing function — no new table, no
-- new cron job (reuses whatever schedule setup-privacy-purge-cron.sql set
-- up for purge_privacy_ttl_data()). Not applied to production by this
-- session; requires an explicit `supabase db push` / SQL Editor run by you.

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

  return jsonb_build_object(
    'ok', true,
    'telegram_ai_threads', deleted_threads,
    'product_cache', deleted_product_cache,
    'price_scrape_cache', deleted_scrape_cache,
    'ai_request_log', deleted_ai_logs,
    'search_metrics', deleted_search_metrics,
    'telegram_product_sessions', deleted_telegram_sessions,
    'ran_at', now()
  );
end;
$$;

comment on function public.purge_privacy_ttl_data() is
  'Privacy retention: purge expired Telegram AI threads, stale product/scrape caches, '
  '90d telemetry logs, and Telegram product-session pointers idle 30+ days.';
