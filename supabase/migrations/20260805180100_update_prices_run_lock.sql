-- Cheap lease lock for update-prices (PostgREST-safe; session advisory locks do not hold across RPCs)

create table if not exists public.update_prices_run_lock (
  id int primary key default 1 check (id = 1),
  locked_until timestamptz not null default 'epoch'::timestamptz,
  locked_by text null
);

insert into public.update_prices_run_lock (id, locked_until, locked_by)
values (1, 'epoch'::timestamptz, null)
on conflict (id) do nothing;

comment on table public.update_prices_run_lock is
  'Single-row lease so overlapping update-prices cron/GH runs skip with ok:true';

create or replace function public.try_acquire_update_prices_lock(
  ttl_seconds int default 180,
  p_locked_by text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl int := greatest(coalesce(ttl_seconds, 180), 30);
  updated_id int;
begin
  update public.update_prices_run_lock
  set
    locked_until = now() + make_interval(secs => ttl),
    locked_by = p_locked_by
  where id = 1
    and locked_until < now()
  returning id into updated_id;

  return updated_id is not null;
end;
$$;

create or replace function public.release_update_prices_lock()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.update_prices_run_lock
  set
    locked_until = now(),
    locked_by = null
  where id = 1;
end;
$$;

revoke all on function public.try_acquire_update_prices_lock(int, text) from public;
revoke all on function public.release_update_prices_lock() from public;
grant execute on function public.try_acquire_update_prices_lock(int, text) to service_role;
grant execute on function public.release_update_prices_lock() to service_role;
revoke all on table public.update_prices_run_lock from public;
grant select, update, insert on table public.update_prices_run_lock to service_role;
