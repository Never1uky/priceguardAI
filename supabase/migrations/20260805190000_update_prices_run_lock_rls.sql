-- Security Advisor: public.update_prices_run_lock exposed to PostgREST without RLS.
-- Access is service_role / security definer RPC only — enable RLS with no policies.

alter table public.update_prices_run_lock enable row level security;

revoke all on table public.update_prices_run_lock from anon, authenticated;
