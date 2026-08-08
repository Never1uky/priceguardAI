-- SEO product grouping (one model ≈ one primary page). Non-destructive.
-- Alias rows keep their slug; primary_slug points at the canonical page.

alter table public.seo_product_pages
  add column if not exists canon_id text null;

alter table public.seo_product_pages
  add column if not exists is_primary boolean not null default true;

alter table public.seo_product_pages
  add column if not exists primary_slug text null;

comment on column public.seo_product_pages.canon_id is
  'Optional product group id (canon:brand|model|storage|category). Null = per-SKU page.';
comment on column public.seo_product_pages.is_primary is
  'True for the main SEO page of a canon group; aliases keep published URLs.';
comment on column public.seo_product_pages.primary_slug is
  'When is_primary=false, slug of the primary page for redirects/canonical.';

create index if not exists seo_product_pages_canon_id_idx
  on public.seo_product_pages (canon_id)
  where canon_id is not null;

create index if not exists seo_product_pages_primary_slug_idx
  on public.seo_product_pages (primary_slug)
  where primary_slug is not null;
