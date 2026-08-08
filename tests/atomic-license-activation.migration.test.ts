import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../supabase/migrations/20260808120000_atomic_license_activation.sql',
);

describe('atomic license activation migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('defines activate_license_device with row lock and atomic increment', () => {
    expect(sql).toMatch(/create or replace function public\.activate_license_device/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/activations_count\s*=\s*v_count\s*\+\s*1/i);
    expect(sql).toMatch(/limit_reached/);
    expect(sql).toMatch(/already_active/);
    expect(sql).toMatch(/security definer/i);
  });

  it('restricts execute to service_role only', () => {
    expect(sql).toMatch(/revoke all on function public\.activate_license_device/i);
    expect(sql).toMatch(/from anon,\s*authenticated/i);
    expect(sql).toMatch(
      /grant execute on function public\.activate_license_device\([^)]+\) to service_role/i,
    );
  });

  it('counts live activation rows under lock', () => {
    expect(sql).toMatch(/select count\(\*\)\s*::integer/i);
  });
});
