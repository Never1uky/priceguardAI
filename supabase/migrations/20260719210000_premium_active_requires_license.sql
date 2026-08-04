-- Premium active only with linked, active, non-expired license_keys
create or replace function public.is_user_premium_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_premium up
    join public.license_keys lk on lk.id = up.license_key_id
    where up.user_id = p_user_id
      and (up.expires_at is null or up.expires_at > now())
      and lk.is_active is true
      and (lk.expires_at is null or lk.expires_at > now())
  );
$$;

comment on function public.is_user_premium_active(uuid) is
  'True when user_premium is linked to an active non-expired license_keys row.';
