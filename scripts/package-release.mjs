#!/usr/bin/env node
/**
 * Multi-store release zip WITHOUT version bump.
 *
 * CWS bump workflow stays: `npm run package:zip`
 * This script: build → zip current version → validate-zip → SHA-256 → metadata.
 *
 * Usage: npm run package:release
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function runCapture(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || '');
    process.exit(r.status ?? 1);
  }
  return (r.stdout || '') + (r.stderr || '');
}

console.log('\n📦 package:release (no version bump)\n');

run('npm', ['run', 'build']);

const pkgOut = runCapture('node', ['scripts/package.mjs']);
process.stdout.write(pkgOut);
const pathMatch = pkgOut.match(/^Path:\s*(.+)$/m);
if (!pathMatch) {
  console.error('package.mjs did not print Path:');
  process.exit(1);
}
const zipPath = pathMatch[1].trim();

run('node', ['scripts/validate-zip.mjs']);

const buf = readFileSync(zipPath);
const sha256 = createHash('sha256').update(buf).digest('hex');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distManifest = JSON.parse(readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'));
const ext = distManifest.externally_connectable?.matches ?? [];
const hasLocalhost = ext.some((m) => /localhost|127\.0\.0\.1/i.test(m));

const metadata = {
  version: pkg.version,
  distVersion: distManifest.version,
  zip: zipPath,
  bytes: statSync(zipPath).size,
  sha256,
  manifest_version: distManifest.manifest_version,
  service_worker: distManifest.background?.service_worker,
  externally_connectable: ext,
  localhostStripped: !hasLocalhost,
  stores: ['chrome-web-store', 'edge-add-ons', 'yandex-via-cws'],
  note: 'Same zip for all Chromium stores. package:zip still bumps for CWS iterate-builds.',
};

if (hasLocalhost) {
  console.error('FAIL: dist externally_connectable still has localhost');
  process.exit(1);
}
if (pkg.version !== distManifest.version) {
  console.error('FAIL: package.json version !== dist/manifest.json version');
  process.exit(1);
}

console.log('\n—— release metadata ——');
console.log(JSON.stringify(metadata, null, 2));
console.log('\nГотово:', zipPath.split(/[/\\]/).pop());
console.log('Путь:', zipPath);
console.log('SHA-256:', sha256);
console.log('Версия расширения:', pkg.version);
