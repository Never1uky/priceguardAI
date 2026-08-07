-- Keep search_vector in sync for seo_product_pages FTS (seo-pages search).

create or replace function public.seo_product_pages_touch_search_vector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(new.brand, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(new.category, '')), 'B')
    || setweight(
      to_tsvector(
        'simple',
        coalesce(new.analysis_snapshot->>'qualitySummary', '')
      ),
      'B'
    );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists seo_product_pages_search_vector_trg on public.seo_product_pages;
create trigger seo_product_pages_search_vector_trg
  before insert or update of title, brand, category, analysis_snapshot
  on public.seo_product_pages
  for each row
  execute function public.seo_product_pages_touch_search_vector();

revoke all on function public.seo_product_pages_touch_search_vector() from public;
