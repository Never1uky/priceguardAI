import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Regression guard for a real perf fix: update-prices used to process SKU
 * groups strictly one at a time (`for (const group of groupsForRun)` with an
 * artificial 20-40ms delay after each), which meant only a fraction of
 * DEFAULT_UPDATE_PRICES_MAX_GROUPS fit inside the 115s runtime budget per
 * cron run. Groups are independent (unique marketplace+product_id, disjoint
 * tracked_products rows), so batching them concurrently is safe and does
 * NOT increase Scrappey call volume — same total requests, just overlapped.
 *
 * Can't run index.ts directly under vitest (Deno.serve + esm.sh createClient
 * import, same constraint as everywhere else in this project) — this is a
 * structural check on the source so a future edit can't silently revert to
 * one-group-at-a-time processing.
 */
describe('performance: update-prices processes SKU groups concurrently', () => {
  it('uses Promise.all over a batch, not a sequential await-per-group loop', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../supabase/functions/update-prices/index.ts'),
      'utf-8',
    );
    expect(source).toMatch(/await Promise\.all\(batch\.map\(\(group\) => processGroup\(group\)\)\)/);
    // The old sequential pattern must be gone.
    expect(source).not.toMatch(/for \(const group of groupsForRun\)/);
    // No artificial per-group jitter delay left — the concurrency limit
    // itself is now what paces request volume.
    expect(source).not.toMatch(/await delay\(group\.priority \? 20 : 40\)/);
  });

  it('concurrency is bounded (not unbounded Promise.all over everything at once)', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../supabase/functions/update-prices/index.ts'),
      'utf-8',
    );
    expect(source).toMatch(/groupsForRun\.slice\(batchStart, batchStart \+ CONCURRENCY\)/);
  });
});
