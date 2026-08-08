import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Structural guard for product_price_history compaction (Stage I retention
 * follow-up). Live SQL can't run here — assert the migration still encodes
 * the decided tiers: full resolution <30d, weekly min+max for 30d–1y,
 * monthly min+max beyond 1y; never averages; service_role only.
 */
describe('security/price-history: compact_price_history()', () => {
  it('migration defines min+max bucket compaction with 30d / 365d tiers', async () => {
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/migrations/20260808170000_compact_price_history.sql',
      ),
      'utf-8',
    );

    expect(migration).toMatch(/create or replace function public\.compact_price_history\(\)/i);
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/interval '30 days'/);
    expect(migration).toMatch(/interval '365 days'/);
    expect(migration).toMatch(/date_trunc\('week'/);
    expect(migration).toMatch(/date_trunc\('month'/);
    expect(migration).toMatch(/price asc/);
    expect(migration).toMatch(/price desc/);
    expect(migration).not.toMatch(/avg\s*\(/i);
    expect(migration).toMatch(/grant execute on function public\.compact_price_history\(\) to service_role/);
    expect(migration).not.toMatch(
      /grant execute on function public\.compact_price_history\(\) to (anon|authenticated)/,
    );
  });

  it('cron setup script schedules compact_price_history (not a migration)', async () => {
    const cron = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/scripts/setup-price-history-compaction-cron.sql',
      ),
      'utf-8',
    );
    expect(cron).toMatch(/priceguard-compact-price-history/);
    expect(cron).toMatch(/select public\.compact_price_history\(\)/);
    expect(cron).toMatch(/cron\.schedule/);
  });
});
