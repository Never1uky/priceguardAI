-- Anti-abuse: one Premium trial per Telegram chat_id and per device_id.
-- Written only by Edge claim-trial (service role). Clients have no INSERT/UPDATE.

create table if not exists public.trial_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  telegram_chat_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint trial_claims_device_id_nonempty check (length(trim(device_id)) > 0),
  constraint trial_claims_chat_id_nonempty check (length(trim(telegram_chat_id)) > 0)
);

comment on table public.trial_claims is
  'Одноразовый claim пробного Premium. Источник правды для антиабуза; локальный trial в расширении — UX. Не путать с user_premium (оплата).';

create unique index if not exists trial_claims_telegram_chat_unique
  on public.trial_claims (telegram_chat_id);

create unique index if not exists trial_claims_device_id_unique
  on public.trial_claims (device_id);

create index if not exists trial_claims_user_id_idx
  on public.trial_claims (user_id);

alter table public.trial_claims enable row level security;

-- No policies for authenticated/anon — Edge uses service role only.
revoke all on table public.trial_claims from anon, authenticated;
grant all on table public.trial_claims to service_role;
