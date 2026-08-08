-- Honest view counter for SEO product pages (MVP; bots may inflate slightly).
alter table public.seo_product_pages
  add column if not exists view_count integer not null default 0,
  add column if not exists view_count_updated_at timestamptz;

comment on column public.seo_product_pages.view_count is
  'Page view counter; incremented via seo-pages hit; UI shows only when >= 10';
