-- PriceGuard AI: лицензии и оплаты
-- Запуск: supabase db push (или через Dashboard → SQL)

-- Платежи (ЮKassa)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  plan text not null check (plan in ('monthly', 'lifetime')),
  amount_rub integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'canceled', 'failed')),
  yookassa_payment_id text unique,
  license_key_id uuid,
  customer_email text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Лицензионные ключи
create table if not exists public.license_keys (
  id uuid primary key default gen_random_uuid(),
  key_code text unique not null,
  plan text not null check (plan in ('monthly', 'lifetime')),
  expires_at timestamptz,
  max_activations integer not null default 2,
  activations_count integer not null default 0,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  note text,
  payment_id uuid references public.payments(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.payments
  add constraint payments_license_key_id_fkey
  foreign key (license_key_id) references public.license_keys(id) on delete set null;

-- Активации по устройствам
create table if not exists public.license_activations (
  id uuid primary key default gen_random_uuid(),
  license_key_id uuid not null references public.license_keys(id) on delete cascade,
  device_id text not null,
  extension_version text,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_key_id, device_id)
);

create index if not exists idx_license_keys_key_code on public.license_keys (key_code);
create index if not exists idx_payments_session_id on public.payments (session_id);
create index if not exists idx_payments_yookassa_id on public.payments (yookassa_payment_id);

-- RLS: таблицы доступны только service_role (через Edge Functions)
alter table public.payments enable row level security;
alter table public.license_keys enable row level security;
alter table public.license_activations enable row level security;

-- Нет политик для anon/authenticated → прямой доступ закрыт

-- Демо-ключи для тестирования
insert into public.license_keys (key_code, plan, expires_at, max_activations, is_demo, note)
values
  ('PGAI-DEMO-MONTH-2026', 'monthly', now() + interval '30 days', 5, true, 'Демо: Premium на 30 дней'),
  ('PGAI-DEMO-LIFE-2026', 'lifetime', null, 5, true, 'Демо: Premium навсегда'),
  ('PGAI-TEST-12345-LIFE', 'lifetime', null, 10, true, 'Тестовый ключ для разработки'),
  ('PGAI-BETA-7DAY-TEST', 'monthly', now() + interval '7 days', 3, true, 'Демо: 7 дней Premium'),
  ('PGAI-DEMO-MONTH-FREE', 'monthly', now() + interval '30 days', 3, true, 'Бета-тестеры: месяц бесплатно')
on conflict (key_code) do nothing;
