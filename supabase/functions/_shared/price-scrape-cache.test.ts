/**
 * MEGA-4: bare Mega goodsId for price_scrape_cache PK.
 * Run: deno test --allow-env supabase/functions/_shared/price-scrape-cache.test.ts
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { bareCacheProductId } from './price-scrape-cache.ts';

Deno.test('bareCacheProductId megamarket strips non-digits', () => {
  assertEquals(
    bareCacheProductId('megamarket', 'smartfon-100067205836'),
    '100067205836',
  );
  assertEquals(bareCacheProductId('megamarket', '100067205836'), '100067205836');
});

Deno.test('bareCacheProductId aliexpress strips to 8+ digit item id', () => {
  assertEquals(
    bareCacheProductId('aliexpress', 'item-1005001234567890'),
    '1005001234567890',
  );
  assertEquals(
    bareCacheProductId('aliexpress', '1005001234567890'),
    '1005001234567890',
  );
});

Deno.test('bareCacheProductId core trio uses strip prefix', () => {
  assertEquals(bareCacheProductId('wildberries', 'wb-12345678'), '12345678');
  assertEquals(bareCacheProductId('ozon', 'ozon-987'), '987');
});
