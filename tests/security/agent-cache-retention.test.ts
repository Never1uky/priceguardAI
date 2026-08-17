import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Structural guards for AI Shopping Agent schema (Stage 1):
 * search_results_cache is a 6h TTL cache (purged); agent_searches is not.
 * Live SQL can't run here — assert migration text.
 */
describe('security/agent-cache: search_results_cache TTL + grants', () => {
  it('latest purge_privacy_ttl_data() deletes search_results_cache older than 6 hours', async () => {
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/migrations/20260817120100_purge_search_results_cache.sql',
      ),
      'utf-8',
    );

    expect(migration).toMatch(/create or replace function public\.purge_privacy_ttl_data\(\)/i);
    expect(migration).toMatch(/security definer/i);

    const deleteRe = new RegExp(
      String.raw`delete from public\.search_results_cache[\s\S]{0,60}now\(\) - interval '6 hours'`,
    );
    expect(migration, 'missing 6h DELETE for search_results_cache').toMatch(deleteRe);
    expect(migration).toMatch(/'search_results_cache',\s*deleted_search_results_cache/);

    expect(migration).not.toMatch(/delete from public\.agent_searches/);
  });

  it('search_results_cache has RLS, no client policies, no grant to anon/authenticated', async () => {
    const migration = await fs.readFile(
      path.resolve(
        __dirname,
        '../../supabase/migrations/20260817120000_agent_searches.sql',
      ),
      'utf-8',
    );

    const cacheStart = migration.indexOf('create table if not exists public.search_results_cache');
    expect(cacheStart).toBeGreaterThanOrEqual(0);
    const cacheSql = migration.slice(cacheStart);

    expect(cacheSql).toMatch(
      /alter table public\.search_results_cache enable row level security/,
    );
    expect(cacheSql).not.toMatch(/create policy/i);
    expect(cacheSql).toMatch(
      /revoke all on table public\.search_results_cache from anon,\s*authenticated/,
    );
    expect(cacheSql).not.toMatch(
      /grant (all|select|insert|update|delete).*on table public\.search_results_cache to (anon|authenticated)/i,
    );
    expect(cacheSql).toMatch(
      /grant all on table public\.search_results_cache to service_role/,
    );
  });
});
