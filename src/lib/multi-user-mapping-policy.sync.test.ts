/**
 * Drift guard: keep Vite (`src/lib/multi-user-mapping-policy.ts`) and Edge
 * (`supabase/functions/_shared/multi-user-mapping.ts`) MULTI_USER_* thresholds in sync.
 * Compares extracted numeric constants only (not whole-file formatting).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const CONST_NAMES = [
  'MULTI_USER_MIN_ACCEPTS',
  'MULTI_USER_MIN_ACCEPT_DAYS',
  'MULTI_USER_MIN_DISTINCT_USERS',
  'MULTI_USER_MIN_AVG_CONFIDENCE',
  'MULTI_USER_MIN_TITLE_SCORE',
  'DISPUTE_COOLDOWN_DAYS',
] as const;

function extractNumericConsts(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of CONST_NAMES) {
    const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d+)\\s*;`);
    const m = source.match(re);
    if (!m) throw new Error(`Missing ${name} in source`);
    out[name] = Number(m[1]);
  }
  return out;
}

describe('multi-user mapping policy sync (extension ↔ edge)', () => {
  it('keeps MULTI_USER_* and DISPUTE_COOLDOWN_DAYS thresholds identical', () => {
    const extension = readFileSync(
      join(ROOT, 'src/lib/multi-user-mapping-policy.ts'),
      'utf8',
    );
    const edge = readFileSync(
      join(ROOT, 'supabase/functions/_shared/multi-user-mapping.ts'),
      'utf8',
    );
    expect(extractNumericConsts(extension)).toEqual(extractNumericConsts(edge));
  });
});
