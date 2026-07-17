-- AI pipeline metrics: Sonar → GPT, web research cache flags, perplexity provider

alter table public.ai_request_log
  drop constraint if exists ai_request_log_provider_check;

alter table public.ai_request_log
  add constraint ai_request_log_provider_check
  check (provider in ('grok', 'openai', 'perplexity'));

alter table public.ai_request_log
  add column if not exists pipeline text;

alter table public.ai_request_log
  add column if not exists web_research_used boolean;

alter table public.ai_request_log
  add column if not exists web_research_cached boolean;

create index if not exists ai_request_log_pipeline_time_idx
  on public.ai_request_log (pipeline, created_at desc);

-- Расширенная статистика AI с pipeline
create or replace view public.vw_ai_pipeline_daily
with (security_invoker = false) as
select
  coalesce(pipeline, 'single') as pipeline,
  date_trunc('day', created_at at time zone 'UTC')::date as day,
  count(*)::bigint as request_count,
  count(*) filter (where success)::bigint as success_count,
  count(*) filter (where web_research_used)::bigint as web_research_count,
  count(*) filter (where web_research_cached)::bigint as web_research_cached_count,
  round(avg(duration_ms)::numeric, 0) as avg_duration_ms
from public.ai_request_log
where created_at >= now() - interval '30 days'
group by coalesce(pipeline, 'single'), date_trunc('day', created_at at time zone 'UTC')::date
order by day desc, pipeline;
