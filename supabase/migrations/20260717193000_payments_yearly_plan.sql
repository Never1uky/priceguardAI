-- Добавить тариф yearly (2490 ₽/год) в payments и license_keys

alter table public.payments
  drop constraint if exists payments_plan_check;

alter table public.payments
  add constraint payments_plan_check
  check (plan in ('monthly', 'yearly', 'lifetime'));

alter table public.license_keys
  drop constraint if exists license_keys_plan_check;

alter table public.license_keys
  add constraint license_keys_plan_check
  check (plan in ('monthly', 'yearly', 'lifetime'));
