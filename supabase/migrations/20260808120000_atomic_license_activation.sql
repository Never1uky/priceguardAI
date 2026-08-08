-- Atomic license device activation (fixes check-then-increment race in validate-license).
-- Concurrent activates for different device_ids serialize on license_keys row lock.
--
-- Expected behavior (manual / integration):
--   max_activations=1, activations_count=0, two parallel RPC with device A and B
--     → exactly one activated, one limit_reached; activations_count = 1
--   repeat same device_id → already_active, activations_count unchanged

create or replace function public.activate_license_device(
  p_license_key_id uuid,
  p_device_id text,
  p_user_id uuid,
  p_extension_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_active boolean;
  v_count integer;
  v_existing uuid;
begin
  if p_license_key_id is null or nullif(trim(p_device_id), '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'bad_request',
      'message', 'license_key_id и device_id обязательны'
    );
  end if;

  select lk.max_activations, lk.is_active
    into v_max, v_active
  from public.license_keys lk
  where lk.id = p_license_key_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_found',
      'message', 'Ключ не найден'
    );
  end if;

  if v_active is not true then
    return jsonb_build_object(
      'ok', false,
      'code', 'inactive',
      'message', 'Ключ деактивирован'
    );
  end if;

  select la.id
    into v_existing
  from public.license_activations la
  where la.license_key_id = p_license_key_id
    and la.device_id = trim(p_device_id)
  limit 1;

  if v_existing is not null then
    update public.license_activations
    set
      last_seen_at = now(),
      user_id = coalesce(p_user_id, user_id),
      extension_version = coalesce(nullif(trim(p_extension_version), ''), extension_version)
    where id = v_existing;

    return jsonb_build_object(
      'ok', true,
      'code', 'already_active'
    );
  end if;

  select count(*)::integer
    into v_count
  from public.license_activations la
  where la.license_key_id = p_license_key_id;

  if v_count >= v_max then
    update public.license_keys
    set activations_count = v_count
    where id = p_license_key_id;

    return jsonb_build_object(
      'ok', false,
      'code', 'limit_reached',
      'message', format(
        'Лимит устройств (%s). Деактивируйте на другом устройстве.',
        v_max
      ),
      'max_activations', v_max,
      'activations_count', v_count
    );
  end if;

  insert into public.license_activations (
    license_key_id,
    device_id,
    extension_version,
    user_id
  ) values (
    p_license_key_id,
    trim(p_device_id),
    nullif(trim(p_extension_version), ''),
    p_user_id
  );

  update public.license_keys
  set activations_count = v_count + 1
  where id = p_license_key_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'activated',
    'activations_count', v_count + 1,
    'max_activations', v_max
  );
exception
  when unique_violation then
    -- Same device raced itself: treat as already_active touch.
    update public.license_activations
    set
      last_seen_at = now(),
      user_id = coalesce(p_user_id, user_id),
      extension_version = coalesce(nullif(trim(p_extension_version), ''), extension_version)
    where license_key_id = p_license_key_id
      and device_id = trim(p_device_id);

    return jsonb_build_object(
      'ok', true,
      'code', 'already_active'
    );
end;
$$;

comment on function public.activate_license_device(uuid, text, uuid, text) is
  'Atomically activate a license on a device (row lock on license_keys). service_role only.';

revoke all on function public.activate_license_device(uuid, text, uuid, text) from public;
revoke all on function public.activate_license_device(uuid, text, uuid, text) from anon, authenticated;
grant execute on function public.activate_license_device(uuid, text, uuid, text) to service_role;
