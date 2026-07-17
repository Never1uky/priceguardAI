#!/usr/bin/env node
/**
 * Preflight QA checks before Chrome Web Store publish.
 * Usage: npm run qa:preflight
 */
import { readFile, stat, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const results = [];

function pass(msg) {
  results.push({ ok: true, msg });
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  results.push({ ok: false, msg });
  console.error(`  ✗ ${msg}`);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n🔍 PriceGuard AI — QA Preflight\n');

  // Version sync
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const version = pkg.version;

  if (manifest.version === version) {
    pass(`Version sync: ${version} (package.json = manifest.json)`);
  } else {
    fail(`Version mismatch: package=${version}, manifest=${manifest.version}`);
  }

  // Icons
  const iconSizes = [16, 32, 48, 128];
  for (const size of iconSizes) {
    const p = join(root, 'public', 'icons', `icon${size}.png`);
    if (await fileExists(p)) {
      pass(`Icon icon${size}.png exists`);
    } else {
      fail(`Missing icon: public/icons/icon${size}.png`);
    }
  }

  // Privacy policy HTML
  const privacyFiles = [
    'docs/index.html',
    'docs/privacy/index.html',
    'docs/privacy/en.html',
    'docs/privacy/styles.css',
  ];
  for (const f of privacyFiles) {
    if (await fileExists(join(root, f))) {
      pass(`${f}`);
    } else {
      fail(`Missing: ${f}`);
    }
  }

  // Dist build (optional warning)
  const distManifest = join(root, 'dist', 'manifest.json');
  if (await fileExists(distManifest)) {
    const dist = JSON.parse(await readFile(distManifest, 'utf8'));
    if (dist.version === version) {
      pass(`dist/manifest.json version ${version}`);
    } else {
      fail(`dist/ outdated: ${dist.version} (run npm run build)`);
    }
  } else {
    fail('dist/ not found — run npm run build');
  }

  // Zip artifact
  const zipName = `priceguard-ai-v${version}.zip`;
  const zipPath = join(root, zipName);
  if (await fileExists(zipPath)) {
    const info = await stat(zipPath);
    if (info.size > 100_000) {
      pass(`${zipName} (${info.size} bytes)`);
    } else {
      fail(`${zipName} too small (${info.size} bytes)`);
    }
  } else {
    fail(`Missing ${zipName} — run npm run package:zip`);
  }

  // Manifest MV3 checks
  if (manifest.manifest_version === 3) {
    pass('Manifest V3');
  } else {
    fail('Expected manifest_version 3');
  }

  const requiredPerms = ['storage', 'activeTab', 'notifications', 'alarms'];
  for (const p of requiredPerms) {
    if (manifest.permissions?.includes(p)) {
      pass(`Permission: ${p}`);
    } else {
      fail(`Missing permission: ${p}`);
    }
  }

  const hosts = ['wildberries.ru', 'ozon.ru', 'market.yandex.ru', 'supabase.co'];
  for (const h of hosts) {
    const found = manifest.host_permissions?.some((hp) => hp.includes(h));
    if (found) {
      pass(`Host permission: *${h}*`);
    } else {
      fail(`Missing host permission for ${h}`);
    }
  }

  // Edge functions
  const edgeFns = ['ai-proxy', 'product-cache', 'validate-license', 'price-alert-notify'];
  for (const fn of edgeFns) {
    const p = join(root, 'supabase', 'functions', fn, 'index.ts');
    if (await fileExists(p)) {
      pass(`Edge function: ${fn}`);
    } else {
      fail(`Missing edge function: ${fn}`);
    }
  }

  // Docs
  const docs = ['QA_DEBUG_CHECKLIST.md', 'CHROME_WEB_STORE_LISTING.md', 'PRIVACY_POLICY_RU.md'];
  for (const d of docs) {
    if (await fileExists(join(root, 'docs', d))) {
      pass(`Doc: ${d}`);
    } else {
      fail(`Missing doc: docs/${d}`);
    }
  }

  // TypeScript (quick)
  try {
    execSync('npx tsc --noEmit', { cwd: root, stdio: 'pipe' });
    pass('TypeScript: no errors');
  } catch {
    fail('TypeScript errors — run npx tsc --noEmit');
  }

  // Summary
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '─'.repeat(40));
  if (failed.length === 0) {
    console.log(`✅ Preflight PASSED (${results.length} checks)\n`);
    process.exit(0);
  } else {
    console.log(`❌ Preflight FAILED: ${failed.length}/${results.length} checks\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
