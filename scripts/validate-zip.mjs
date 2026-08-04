import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

function resolveZipPath() {
  const prefix = `priceguard-ai-v${version}`;
  const candidates = readdirSync(root)
    .filter((n) => n === `${prefix}.zip` || (n.startsWith(`${prefix}(`) && n.endsWith('.zip')))
    .map((n) => {
      const p = join(root, n);
      return { p, mtime: statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) {
    throw new Error(`No zip found for ${prefix}`);
  }
  return candidates[0].p;
}

const zip = resolveZipPath();

const zipList = execSync(`tar -tf "${zip}"`, { encoding: 'utf8' }).trim().split(/\r?\n/);
const manifest = JSON.parse(execSync(`tar -xOf "${zip}" manifest.json`, { encoding: 'utf8' }));

const refs = new Set();
function collect(o) {
  for (const v of Object.values(o ?? {})) {
    if (typeof v === 'string') refs.add(v);
    else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && refs.add(x));
    else if (v && typeof v === 'object') collect(v);
  }
}
collect(manifest);

const PATH_REF =
  /^(public\/|icons\/|assets\/|src\/|service-worker|\.\/)/i;
const EXT_REF = /\.(png|jpe?g|webp|svg|js|html|css|json|woff2?)$/i;

const missing = [...refs].filter((r) => {
  if (r.startsWith('http')) return false;
  if (!PATH_REF.test(r) && !EXT_REF.test(r)) return false;
  return !zipList.includes(r);
});

const popupJs = zipList.find((f) => f.startsWith('assets/index.html-') && f.endsWith('.js'));
const edgeJs = zipList.find((f) => f.startsWith('assets/edge-') && f.endsWith('.js'));

const hasPublicIcons = zipList.some((f) => f.startsWith('public/icons/'));
const hasRootIcons = zipList.some((f) => f === 'icons/' || f.startsWith('icons/'));

const failures = [];
if (missing.length) failures.push(`missingRefs: ${missing.join(', ')}`);
if (!hasPublicIcons) failures.push('expected public/icons/* in zip');
if (hasRootIcons) failures.push('unexpected top-level icons/ (duplicate of public/icons)');

console.log(JSON.stringify({
  zip,
  entries: zipList.length,
  version: manifest.version,
  popup: manifest.action?.default_popup,
  serviceWorker: manifest.background?.service_worker,
  missingRefs: missing,
  popupJs,
  edgeJs,
  hasPublicIcons,
  hasRootIcons,
}, null, 2));

if (popupJs) {
  const js = execSync(`tar -xOf "${zip}" "${popupJs}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  console.log('demoKeyInBundle:', js.includes('PGAI-DEMO-LIFE-2026'));
}

if (edgeJs) {
  const edge = execSync(`tar -xOf "${zip}" "${edgeJs}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const logCount = (edge.match(/console\.log\s*\(/g) ?? []).length;
  const debugCount = (edge.match(/console\.debug\s*\(/g) ?? []).length;
  const logIdent = (edge.match(/console\.log\b/g) ?? []).length;
  const debugIdent = (edge.match(/console\.debug\b/g) ?? []).length;
  const localhost9999 = edge.includes('localhost:9999');
  const edgeUrl = edge.match(/https:\/\/[a-z0-9-]+\.supabase\.co/);
  console.log('supabaseInEdge:', Boolean(edgeUrl));
  console.log('supabaseUrlEdge:', edgeUrl?.[0] ?? null);
  console.log('edgeConsoleLogCalls:', logCount);
  console.log('edgeConsoleDebugCalls:', debugCount);
  console.log('edgeConsoleLogIdents:', logIdent);
  console.log('edgeConsoleDebugIdents:', debugIdent);
  console.log('edgeLocalhost9999:', localhost9999);
  console.log(
    'localhost9999Note:',
    'Supabase JS SDK default fallback only; prod uses VITE_SUPABASE_URL (https). Dead string OK.',
  );
  if (logCount > 0 || debugCount > 0) {
    failures.push(`edge still has console.log=${logCount} console.debug=${debugCount}`);
  }
  if (!edgeUrl) {
    failures.push('prod supabase URL not found in edge bundle');
  }
}

if (failures.length) {
  console.error('validate-zip FAILED:\n- ' + failures.join('\n- '));
  process.exit(1);
}

console.log('validate-zip OK');
