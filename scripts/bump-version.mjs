/**
 * Bump extension version for each package:zip so builds are distinguishable.
 * Scheme: 0.9.0 → 0.9.01 → 0.9.02 → … → 0.9.10 → …
 * (Chrome strips leading zeros for comparison; zip/name keep the padded form.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(rootDir, 'package.json');
const manifestPath = join(rootDir, 'manifest.json');

export function bumpVersionString(version) {
  const parts = String(version).trim().split('.');
  while (parts.length < 3) parts.push('0');

  const major = parts[0] ?? '0';
  const minor = parts[1] ?? '0';
  const patchRaw = parts[2] ?? '0';
  const patchNum = Number.parseInt(patchRaw, 10);
  if (!Number.isFinite(patchNum) || patchNum < 0) {
    throw new Error(`Cannot bump version: ${version}`);
  }

  const nextPatch = patchNum + 1;
  // Keep two-digit patch for 1..9 as 01..09 so 0.9.0 → 0.9.01
  const patchFormatted =
    nextPatch >= 10 ? String(nextPatch) : String(nextPatch).padStart(2, '0');

  return `${major}.${minor}.${patchFormatted}`;
}

function writeJsonVersion(filePath, nextVersion) {
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const prev = data.version;
  data.version = nextVersion;
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return prev;
}

export function bumpPackVersion() {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const next = bumpVersionString(pkg.version);
  const prevPkg = writeJsonVersion(pkgPath, next);
  writeJsonVersion(manifestPath, next);
  console.log(`Version bump: ${prevPkg} → ${next}`);
  return next;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  bumpPackVersion();
}
