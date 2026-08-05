/**
 * Verify relative imports under supabase/functions resolve to existing files.
 * Catches missing _shared modules before deploy (no Deno/network required).
 *
 * Usage: node scripts/check-edge-imports.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

/** Single-line and multiline `from './x'` / `import './x'`. */
const IMPORT_RE =
  /(?:import|export)(?:\s+type)?(?:(?:\s+[\s\S]*?\s+from\s+)|\s+)['"](\.[^'"]+)['"]/g;

function listTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listTsFiles(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    join(base, 'index.ts'),
    join(base, 'index.js'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const files = listTsFiles(FUNCTIONS_DIR);
const missing = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Strip block/line comments so commented imports are ignored
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    if (resolveImport(file, spec)) continue;
    missing.push({
      file: normalize(file)
        .replace(normalize(ROOT) + '\\', '')
        .replace(normalize(ROOT) + '/', '')
        .replace(/\\/g, '/'),
      spec,
    });
  }
}

if (missing.length) {
  console.error('Broken relative imports in supabase/functions:\n');
  for (const row of missing) {
    console.error(`  ${row.file}\n    → ${row.spec}`);
  }
  process.exit(1);
}

console.log(`OK: ${files.length} files, all relative imports resolve`);
