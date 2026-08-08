import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Can't run real SQL here (no live Postgres in this environment — see
 * docs/architecture/DATA_RETENTION.md for the "REQUIRES MANUAL VERIFICATION"
 * caveats). This is a structural regression guard on the migration text
 * itself: it asserts every table/TTL decided across Stages C/D/G is still
 * present in the latest purge_privacy_ttl_data() definition, so an edit
 * that silently drops a DELETE clause (e.g. a bad merge) fails CI instead
 * of silently un-deleting data in production.
 */
describe('security/privacy: purge_privacy_ttl_data() covers every documented table', () => {
  it('the latest migration redefining the function includes all expected DELETE clauses', async () => {
    // Latest migration wins (create or replace function) — this is the one
    // that actually applies if all three migrations run in order.
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/migrations/20260808110000_purge_edge_logs_and_telemetry.sql',
      ),
      'utf-8',
    );

    const expectedDeletes: Array<[table: string, interval: string]> = [
      ['telegram_ai_threads', 'expires_at < now()'],
      ['product_cache', "now() - interval '7 days'"],
      ['price_scrape_cache', "now() - interval '2 hours'"],
      ['ai_request_log', "now() - interval '90 days'"],
      ['search_metrics', "now() - interval '90 days'"],
      ['telegram_product_sessions', "now() - interval '30 days'"],
      ['edge_request_log', "now() - interval '72 hours'"],
      ['mapping_moderation_events', "now() - interval '48 hours'"],
      ['telemetry_events', "now() - interval '90 days'"],
    ];

    for (const [table, interval] of expectedDeletes) {
      const deleteRe = new RegExp(
        `delete from public\\.${table}[\\s\\S]{0,60}${interval.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      );
      expect(migration, `missing/changed DELETE clause for ${table}`).toMatch(deleteRe);
    }

    // Function must be SECURITY DEFINER — this migration redefines the body
    // via CREATE OR REPLACE, which does not touch existing grants, so the
    // access-control assertion below is checked against the ORIGINAL
    // migration that first declared them (grants aren't re-declared here).
    expect(migration).toMatch(/security definer/);

    const original = await fs.readFile(
      path.resolve(__dirname, '../../supabase/migrations/20260717210000_privacy_ttl_purge.sql'),
      'utf-8',
    );
    expect(original).toMatch(/grant execute on function public\.purge_privacy_ttl_data\(\) to service_role/);
    expect(original).not.toMatch(/grant execute on function public\.purge_privacy_ttl_data\(\) to (anon|authenticated)/);
  });

  it('cross_market_mapping is intentionally NOT purged (Stage E decision, not an oversight)', async () => {
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/migrations/20260808110000_purge_edge_logs_and_telemetry.sql',
      ),
      'utf-8',
    );
    expect(migration).not.toMatch(/delete from public\.cross_market_mapping/);
    // The migration's own comment should document why, so a future reader
    // doesn't "fix" this as a bug.
    expect(migration.toLowerCase()).toMatch(/cross_market_mapping/);
  });
});
