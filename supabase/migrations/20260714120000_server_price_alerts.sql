-- Server-side price monitoring for Premium + Telegram
-- Tables: user_alert_settings, user_premium
-- Optional: product_url on tracked_products for better fetches

-- ——— Alert settings (synced from extension) ———
create table if not exists public.user_alert_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_enabled boolean not null default false,
  telegram_chat_id text not null default '',
  notifications_enabled boolean not null default true,
  min_drop_rub numeric not null default 100,
  min_drop_percent numeric not null default 1,
  server_monitoring boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.user_alert_settings is
  'Telegram / пороги алертов. server_monitoring=true → update-prices cron шлёт в Telegram.';

alter table public.user_alert_settings enable row level security;

drop policy if exists "user_alert_settings_select_own" on public.user_alert_settings;
create policy "user_alert_settings_select_own"
  on public.user_alert_settings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_alert_settings_upsert_own" on public.user_alert_settings;
create policy "user_alert_settings_upsert_own"
  on public.user_alert_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_alert_settings_update_own" on public.user_alert_settings;
create policy "user_alert_settings_update_own"
  on public.user_alert_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ——— Premium linked to auth user (paid license only) ———
create table if not exists public.user_premium (
  user_id uuid primary key references auth.users(id) on delete cascade,
  license_key_id uuid references public.license_keys(id) on delete set null,
  plan text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.user_premium is
  'Активный Premium, привязанный к аккаунту при входе + активации ключа.';

alter table public.user_premium enable row level security;

drop policy if exists "user_premium_select_own" on public.user_premium;
create policy "user_premium_select_own"
  on public.user_premium for select
  to authenticated
  using (auth.uid() = user_id);

-- ——— Link activations to user (optional) ———
alter table public.license_activations
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_license_activations_user
  on public.license_activations (user_id)
  where user_id is not null;

-- ——— Canonical URL for server fetch ———
alter table public.tracked_products
  add column if not exists product_url text;

-- ——— Helper: is premium active ———
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
    where up.user_id = p_user_id
      and (up.expires_at is null or up.expires_at > now())
  );
$$;

revoke all on function public.is_user_premium_active(uuid) from public;
grant execute on function public.is_user_premium_active(uuid) to service_role;

-- ——— pg_cron setup notes (manual — secrets must not sit in migration) ———
-- Enable in Dashboard: Database → Extensions → pg_cron, pg_net
-- Then run (replace PROJECT_URL and CRON_SECRET):
--
-- select cron.schedule(
--   'priceguard-update-prices',
--   '0 */6 * * *',
--   $$
--   select net.http_post(
--     url := 'https://PROJECT_REF.supabase.co/functions/v1/update-prices',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
--       'x-cron-secret', 'YOUR_UPDATE_PRICES_CRON_SECRET'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- Or use GitHub Actions / external cron every 6h:
--   curl -X POST https://PROJECT_REF.supabase.co/functions/v1/update-prices \
--     -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--     -H "x-cron-secret: $UPDATE_PRICES_CRON_SECRET"
