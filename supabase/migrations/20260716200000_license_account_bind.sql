-- License ↔ account binding for recovery after reinstall
-- payments.user_id: buyer when checkout is done while logged in
-- user_premium.license_key_id unique: one owner per license key

alter table public.payments
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_payments_user_id
  on public.payments (user_id)
  where user_id is not null;

comment on column public.payments.user_id is
  'Auth user who started checkout (nullable for legacy / anonymous attempts).';

-- One license key may belong to at most one account
create unique index if not exists idx_user_premium_license_key_unique
  on public.user_premium (license_key_id)
  where license_key_id is not null;

comment on index public.idx_user_premium_license_key_unique is
  'Prevents binding the same license key to multiple auth accounts.';
