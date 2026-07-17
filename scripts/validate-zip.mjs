import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zip = join(root, `priceguard-ai-v${pkg.version}.zip`);

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

const missing = [...refs].filter((r) => !r.startsWith('http') && !zipList.includes(r));
const popupJs = zipList.find((f) => f.startsWith('assets/index.html-') && f.endsWith('.js'));

console.log(JSON.stringify({
  zip,
  entries: zipList.length,
  version: manifest.version,
  popup: manifest.action?.default_popup,
  serviceWorker: manifest.background?.service_worker,
  missingRefs: missing,
  popupJs,
}, null, 2));

if (popupJs) {
  const js = execSync(`tar -xOf "${zip}" "${popupJs}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const urlMatch = js.match(/https:\/\/[a-z0-9-]+\.supabase\.co/);
  console.log('supabaseInBundle:', Boolean(urlMatch));
  console.log('supabaseUrl:', urlMatch?.[0] ?? null);
  console.log('demoKeyInBundle:', js.includes('PGAI-DEMO-LIFE-2026'));
}
