-- Safe cleanup: strip "SEO Smoke" / fixture markers from seo_product_pages.title.
-- Non-destructive: only UPDATE titles that still contain known junk markers.
-- Review SELECT first; run UPDATE manually when needed.
--
-- Does NOT delete rows, change publish_status, or touch analysis_snapshot.

-- Preview dirty titles:
-- SELECT slug, title
-- FROM seo_product_pages
-- WHERE title ~* 'SEO[[:space:]]*Smoke'
--    OR title ~* 'smoke[[:space:]]*fixture'
--    OR title ~* 'test[[:space:]]*fixture';

UPDATE seo_product_pages
SET
  title = trim(both ' ' FROM regexp_replace(
    regexp_replace(
      regexp_replace(title, 'SEO[[:space:]]*Smoke', ' ', 'gi'),
      'smoke[[:space:]]*fixture',
      ' ',
      'gi'
    ),
    'test[[:space:]]*fixture',
    ' ',
    'gi'
  )),
  updated_at = now()
WHERE title ~* 'SEO[[:space:]]*Smoke'
   OR title ~* 'smoke[[:space:]]*fixture'
   OR title ~* 'test[[:space:]]*fixture';

-- Optional: normalize mistaken 11–100 quality_score into 1–10 (review first).
-- SELECT slug, quality_score FROM seo_product_pages
-- WHERE quality_score IS NOT NULL AND quality_score > 10 AND quality_score <= 100;
--
-- UPDATE seo_product_pages
-- SET quality_score = round((quality_score / 10.0)::numeric, 1),
--     updated_at = now()
-- WHERE quality_score IS NOT NULL
--   AND quality_score > 10
--   AND quality_score <= 100;
