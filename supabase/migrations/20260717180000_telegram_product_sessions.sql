-- Telegram product intelligence: текущий товар в чате + AI-треды

create table if not exists public.telegram_product_sessions (
  chat_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  marketplace text not null check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,
  product_key text not null,
  product_url text,
  product_title text,
  mode text not null default 'card' check (mode in ('card', 'ai_chat')),
  last_card_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_product_sessions_product_key_idx
  on public.telegram_product_sessions (product_key);

create index if not exists telegram_product_sessions_user_id_idx
  on public.telegram_product_sessions (user_id);

alter table public.telegram_product_sessions enable row level security;

create table if not exists public.telegram_ai_threads (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  product_key text not null,
  rolling_summary text,
  turns jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_ai_threads_chat_product_idx
  on public.telegram_ai_threads (chat_id, product_key);

create index if not exists telegram_ai_threads_expires_idx
  on public.telegram_ai_threads (expires_at);

alter table public.telegram_ai_threads enable row level security;

comment on table public.telegram_product_sessions is
  'Текущий product_key для Alerts-бота (карточка / AI chat).';
comment on table public.telegram_ai_threads is
  'Короткий контекст Q&A без raw reviews; TTL ~48h.';
