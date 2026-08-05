/**
 * Cross-platform: relative import scan + deno check all Edge function entrypoints.
 * Usage: node scripts/deno-check-functions.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'supabase/functions/deno.json');

function run(cmd, args, { shell = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell,
  });
  if (r.error) {
    console.error(r.error.message);
    return 1;
  }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status ?? 1;
}

const importScan = run(process.execPath, [join(ROOT, 'scripts/check-edge-imports.mjs')]);
if (importScan !== 0) process.exit(importScan);

function resolveDeno() {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['deno'], {
    encoding: 'utf8',
    shell: false,
  });
  if (probe.status === 0 && probe.stdout.trim()) {
    return { cmd: 'deno', prefix: [] };
  }
  return { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', prefix: ['--yes', 'deno'] };
}

const deno = resolveDeno();
const functionsDir = join(ROOT, 'supabase/functions');
const entries = readdirSync(functionsDir)
  .map((name) => join(functionsDir, name, 'index.ts'))
  .filter((p) => existsSync(p) && statSync(dirname(p)).isDirectory())
  .sort();

if (!entries.length) {
  console.error('No supabase/functions/*/index.ts found');
  process.exit(1);
}

let fail = 0;
for (const entry of entries) {
  const rel = entry.slice(ROOT.length + 1).replace(/\\/g, '/');
  console.log(`==> deno check ${rel}`);
  const status = run(deno.cmd, [...deno.prefix, 'check', `--config=${CONFIG}`, entry], {
    shell: deno.cmd.endsWith('.cmd'),
  });
  if (status !== 0) fail = 1;
}

if (fail) {
  console.error('deno check failed for one or more functions');
  process.exit(1);
}
console.log(`OK: deno check passed for ${entries.length} functions`);
