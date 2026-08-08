import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Two distinct properties, both required for "User A can't get User B's
 * data via a shared-cache path":
 *
 * 1. Genuinely shared tables (product_cache, price_scrape_cache) must be
 *    keyed ONLY by product identifiers — no user_id column/filter — because
 *    that's the whole point (User B benefits from User A's cached analysis).
 *    This is fine: the data cached there is public marketplace data, not
 *    personal to either user (see docs/architecture/DATA_RETENTION.md).
 *
 * 2. Tables that DO hold personal data (tracked_products, compare_products,
 *    user_alert_settings via sync endpoints) must always scope every query
 *    by a user_id sourced from the verified JWT (requireAuthUser), never
 *    from client-supplied input — otherwise property 1 being safe wouldn't
 *    matter, since personal data would leak through a different door.
 */

const SHARED_CACHE_FUNCTIONS = ['product-cache', 'price-cache'];
const PERSONAL_DATA_FUNCTIONS = ['tracked-sync', 'sync-alert-settings', 'compare-sync'];

describe('security: cache isolation between users', () => {
  it.each(SHARED_CACHE_FUNCTIONS)(
    '%s: no user_id column/filter — shared by design, not a leak (contains only public product data)',
    async (fnName) => {
      const source = await fs.readFile(
        path.resolve(__dirname, `../../supabase/functions/${fnName}/index.ts`),
        'utf-8',
      );
      expect(source).not.toMatch(/\.eq\('user_id'/);
      expect(source).not.toMatch(/user_id:/);
    },
  );

  it.each(PERSONAL_DATA_FUNCTIONS)(
    '%s: userId is sourced from the verified JWT, never trusted from the request body',
    async (fnName) => {
      const source = await fs.readFile(
        path.resolve(__dirname, `../../supabase/functions/${fnName}/index.ts`),
        'utf-8',
      );
      expect(source).toMatch(/requireAuthUser\(req,\s*true\)/);
      expect(source).toMatch(/const userId = user!\.id/);
      // Must not accept an attacker-supplied user id as an alternative source.
      expect(source).not.toMatch(/body\.userId/);
      expect(source).not.toMatch(/body\.user_id/);
    },
  );

  it('product_cache table itself has no user_id column (confirms property 1 at the schema level)', async () => {
    const migration = await fs.readFile(
      path.resolve(__dirname, '../../supabase/migrations/20260701120000_cache_sync_metrics.sql'),
      'utf-8',
    );
    const tableBody = migration.slice(
      migration.indexOf('create table'),
      migration.indexOf('create table') + migration.slice(migration.indexOf('create table')).indexOf(');'),
    );
    expect(tableBody).not.toMatch(/user_id/);
  });
});
