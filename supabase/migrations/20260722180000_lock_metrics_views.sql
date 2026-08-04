-- Lock metrics views: security_invoker=false bypasses RLS on base tables.
-- Deny anon/authenticated PostgREST SELECT; metrics-dashboard Edge uses service_role.

revoke all on table public.vw_search_metrics_daily from anon, authenticated;
revoke all on table public.vw_search_metrics_weekly from anon, authenticated;
revoke all on table public.vw_ai_requests from anon, authenticated;
revoke all on table public.vw_wb_success_rate_24h from anon, authenticated;
revoke all on table public.vw_ai_pipeline_daily from anon, authenticated;

grant select on table public.vw_search_metrics_daily to service_role;
grant select on table public.vw_search_metrics_weekly to service_role;
grant select on table public.vw_ai_requests to service_role;
grant select on table public.vw_wb_success_rate_24h to service_role;
grant select on table public.vw_ai_pipeline_daily to service_role;
