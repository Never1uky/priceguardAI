/**
 * Next.js App Router route map for priceguard-seo (docs/SEO_PRODUCT_PAGES.md §4).
 * Used as a single source of truth for path builders / tests.
 */

export const SEO_ROUTES = {
  home: '/',
  analysis: (slug: string) => `/a/${slug}`,
  brand: (brandSlug: string) => `/brand/${brandSlug}`,
  category: (categorySlug: string) => `/category/${categorySlug}`,
  search: '/search',
  sitemap: '/sitemap.xml',
  robots: '/robots.txt',
  rss: '/rss.xml',
  revalidateApi: '/api/revalidate',
} as const;

export const SEO_ISR_REVALIDATE_SECONDS = 3600;

export const SEO_DEFAULT_ORIGIN = 'https://priceguard-seo.vercel.app';
