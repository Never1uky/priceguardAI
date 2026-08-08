-- Safe cleanup: drop marketplace CDN image URLs from SEO pages (no row deletes).
-- Review SELECT first; run UPDATE manually when ready.
--
-- SELECT slug, image_url FROM seo_product_pages
-- WHERE image_url ~* 'wbbasket\.ru|wbcontent\.net|ozone\.ru|cdn\.ozon|avatars\.mds\.yandex';

UPDATE seo_product_pages
SET
  image_url = null,
  updated_at = now()
WHERE image_url is not null
  AND image_url ~* 'wbbasket\.ru|wbcontent\.net|ozone\.ru|cdn\.ozon|avatars\.mds\.yandex';
