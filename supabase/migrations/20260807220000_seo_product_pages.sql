-- Durable SEO snapshots of Full Product Analysis (product_cache v2).
-- Public HTML must NOT read ephemeral product_cache (7d purge).
-- See docs/SEO_PRODUCT_PAGES.md (variant B).

create table if not exists public.seo_product_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  canonical_path text not null,
  marketplace text not null
    check (marketplace in ('wildberries', 'ozon', 'yandex_market')),
  product_id text not null,
  product_key text not null,
  title text not null default '',
  brand text null,
  brand_slug text null,
  category text null,
  category_slug text null,
  analysis_snapshot jsonb not null default '{}'::jsonb,
  analysis_hash text not null,
  analyzed_at timestamptz null,
  offers_snapshot jsonb not null default '[]'::jsonb,
  price_current numeric null,
  currency text not null default 'RUB',
  image_url text null,
  product_url text null,
  rating numeric null,
  quality_score numeric null,
  review_count int not null default 0,
  publish_status text not null default 'draft'
    check (publish_status in ('draft', 'published', 'rejected', 'archived')),
  reject_reason text null,
  search_vector tsvector null,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_product_pages_slug_unique unique (slug),
  constraint seo_product_pages_product_key_unique unique (product_key)
);

create index if not exists seo_product_pages_brand_slug_idx
  on public.seo_product_pages (brand_slug)
  where brand_slug is not null;

create index if not exists seo_product_pages_category_slug_idx
  on public.seo_product_pages (category_slug)
  where category_slug is not null;

create index if not exists seo_product_pages_status_published_at_idx
  on public.seo_product_pages (publish_status, published_at desc nulls last);

create index if not exists seo_product_pages_search_vector_idx
  on public.seo_product_pages using gin (search_vector);

comment on table public.seo_product_pages is
  'Durable public SEO pages from product_cache v2 snapshots; no AI regenerate';
comment on column public.seo_product_pages.analysis_snapshot is
  'Copy of FullProductAnalysis at publish time';
comment on column public.seo_product_pages.analysis_hash is
  'Hash of stable analysis fields; same hash => skip content update';

alter table public.seo_product_pages enable row level security;

revoke all on table public.seo_product_pages from anon, authenticated;
grant select, insert, update, delete on table public.seo_product_pages to service_role;
