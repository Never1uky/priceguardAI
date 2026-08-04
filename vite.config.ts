import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { transformSync } from 'esbuild';
import { visualizer } from 'rollup-plugin-visualizer';
import manifestJson from './manifest.json';
import { contentMatchesToWarOrigins } from './src/build/war-match-pattern';

/** Vite __vitePreload использует document/window — в MV3 service worker их нет. */
function serviceWorkerSafeVitePreload(): Plugin {
  return {
    name: 'service-worker-safe-vite-preload',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!chunk.code.includes('vite:preloadError')) continue;

        chunk.code = chunk.code
          .replace(
            /window\.dispatchEvent\((\w+)\)/g,
            '(typeof window<"u"&&window.dispatchEvent($1))',
          )
          .replaceAll(
            'document.getElementsByTagName("link")',
            '(typeof document<"u"?document.getElementsByTagName("link"):[])',
          )
          .replace(
            /document\.querySelector\(`link\[href="\$\{(\w+)\}"\]\$\{(\w+)\}`\)/g,
            '(typeof document<"u"?document.querySelector(`link[href="${$1}"]${$2}`):null)',
          )
          .replaceAll(
            'document.createElement("link")',
            '(typeof document<"u"?document.createElement("link"):null)',
          )
          .replace(
            /document\.head\.appendChild\((\w+)\)/g,
            '(typeof document<"u"&&$1&&document.head.appendChild($1))',
          )
          .replaceAll(
            'document.querySelector("meta[property=csp-nonce]")',
            '(typeof document<"u"?document.querySelector("meta[property=csp-nonce]"):null)',
          );
      }
    },
  };
}

/**
 * CRX/Vite иногда не прокидывает build.esbuild.drop на все чанки.
 * Повторный esbuild.transform с drop гарантирует вырезание console.* в проде.
 */
function dropConsoleInChunks(): Plugin {
  return {
    name: 'drop-console-in-chunks',
    apply: 'build',
    enforce: 'post',
    renderChunk(code, chunk) {
      if (!chunk.fileName.endsWith('.js')) return null;
      if (!/\bconsole\./.test(code)) return null;
      const result = transformSync(code, {
        loader: 'js',
        format: 'esm',
        drop: ['console', 'debugger'],
        legalComments: 'none',
      });
      // esbuild drop removes calls; SDK may still assign `logger = console.log`
      let next = result.code.replace(
        /([=:]\s*)console\.(log|debug|info|warn|error)\b/g,
        '$1(()=>{})',
      );
      return { code: next, map: result.map || undefined };
    },
  };
}

/**
 * Chrome MV3 forbids runtime `import()` in ServiceWorkerGlobalScope
 * (even with `"type": "module"`). Fail the build if any chunk in the SW
 * dependency graph still contains it after neutralizing known vendor optional peers.
 */
function banServiceWorkerDynamicImport(): Plugin {
  const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;

  function isServiceWorkerEntry(
    fileName: string,
    chunk: { facadeModuleId?: string | null; moduleIds?: string[]; name?: string },
  ): boolean {
    const idBlob = [
      fileName,
      chunk.name ?? '',
      chunk.facadeModuleId ?? '',
      ...(chunk.moduleIds ?? []),
    ]
      .join('\n')
      .replace(/\\/g, '/');

    return (
      /service-worker/i.test(fileName) ||
      /(^|\/)service-worker-loader/i.test(fileName) ||
      /\/src\/background\//i.test(idBlob) ||
      /background\/index/i.test(idBlob)
    );
  }

  /** @supabase/supabase-js optional OTEL peer — `import("@opentelemetry/api")` is illegal in MV3 SW. */
  function neutralizeVendorOptionalImports(code: string): string {
    let next = code.replace(
      /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*(["'])@opentelemetry\/api\1\s*\)/g,
      'Promise.resolve(null)',
    );
    for (const match of code.matchAll(
      /const\s+(\w+)\s*=\s*["']@opentelemetry\/api["']/g,
    )) {
      const binding = match[1];
      next = next.replace(
        new RegExp(`\\bimport\\s*\\(\\s*${binding}\\s*\\)`, 'g'),
        'Promise.resolve(null)',
      );
    }
    return next;
  }

  return {
    name: 'ban-service-worker-dynamic-import',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const chunkEntries = Object.entries(bundle).filter(
        (entry): entry is [string, Extract<(typeof bundle)[string], { type: 'chunk' }>] =>
          entry[1].type === 'chunk',
      );
      const byName = new Map(chunkEntries);

      const swRoots = chunkEntries
        .filter(([fileName, chunk]) => isServiceWorkerEntry(fileName, chunk))
        .map(([fileName]) => fileName);

      const swGraph = new Set<string>();
      const stack = [...swRoots];
      while (stack.length > 0) {
        const fileName = stack.pop()!;
        if (swGraph.has(fileName)) continue;
        swGraph.add(fileName);
        const chunk = byName.get(fileName);
        if (!chunk) continue;
        for (const dep of [...chunk.imports, ...chunk.dynamicImports]) {
          if (byName.has(dep)) stack.push(dep);
        }
      }

      const offenders: string[] = [];
      for (const fileName of swGraph) {
        const chunk = byName.get(fileName);
        if (!chunk) continue;
        chunk.code = neutralizeVendorOptionalImports(chunk.code);
        const match = DYNAMIC_IMPORT_RE.exec(chunk.code);
        if (!match || match.index == null) continue;
        const start = Math.max(0, match.index - 80);
        const end = Math.min(chunk.code.length, match.index + 120);
        const snippet = chunk.code.slice(start, end).replace(/\s+/g, ' ');
        offenders.push(`${fileName} …${snippet}…`);
      }

      if (offenders.length > 0) {
        throw new Error(
          [
            'MV3 Service Worker must not contain runtime import().',
            'Replace with static ES imports on SW-reachable paths.',
            `Offending:\n${offenders.join('\n')}`,
          ].join(' '),
        );
      }
    },
  };
}

type CrxManifest = {
  content_scripts?: Array<{ matches?: string[] }>;
  web_accessible_resources?: Array<{
    matches?: string[];
    resources?: string[];
    use_dynamic_url?: boolean;
  }>;
};

/**
 * CRXJS emits duplicate WAR matches and may expose shared chunks (e.g. edge/supabase)
 * to marketplace origins. Dedupe, narrow to content_script *origins* (MV3 WAR allows
 * only `scheme://host/*` — path patterns fail Chrome load), fail if edge in WAR.
 */
function sanitizeWebAccessibleResources(): Plugin {
  const outDir = resolve(__dirname, 'dist');
  const contentMatches = (manifestJson as CrxManifest).content_scripts?.flatMap(
    (cs) => cs.matches ?? [],
  ) ?? [];

  return {
    name: 'sanitize-web-accessible-resources',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const manifestPath = resolve(outDir, 'manifest.json');
      let raw: string;
      try {
        raw = readFileSync(manifestPath, 'utf8');
      } catch {
        return;
      }

      const distManifest = JSON.parse(raw) as CrxManifest;
      const war = distManifest.web_accessible_resources;
      if (!war?.length) return;

      const narrowed =
        contentMatches.length > 0
          ? contentMatchesToWarOrigins(contentMatches)
          : undefined;

      for (const entry of war) {
        const resources = entry.resources ?? [];
        const edgeHits = resources.filter((r) => /(^|\/)edge[-.]/i.test(r));
        if (edgeHits.length > 0) {
          throw new Error(
            [
              'web_accessible_resources must not expose edge/supabase chunks to marketplace pages.',
              `Offending: ${edgeHits.join(', ')}`,
              'Content scripts must import @/lib/storage-local (not @/lib/storage).',
            ].join(' '),
          );
        }

        if (narrowed?.length) {
          entry.matches = narrowed;
        } else if (entry.matches) {
          entry.matches = contentMatchesToWarOrigins(entry.matches);
        }
      }

      writeFileSync(manifestPath, `${JSON.stringify(distManifest, null, 2)}\n`, 'utf8');
    },
  };
}

/**
 * Vite copies public/ → dist/icons; CRX also keeps public/icons for manifest paths.
 * Drop the unused top-level dist/icons duplicate (manifest uses public/icons/*).
 */
function stripDuplicateRootIcons(): Plugin {
  const iconsDir = join(resolve(__dirname, 'dist'), 'icons');
  return {
    name: 'strip-duplicate-root-icons',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      if (existsSync(iconsDir)) {
        rmSync(iconsDir, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze' || process.env.ANALYZE === '1';

  return {
    plugins: [
      react(),
      crx({ manifest: manifestJson }),
      serviceWorkerSafeVitePreload(),
      banServiceWorkerDynamicImport(),
      dropConsoleInChunks(),
      sanitizeWebAccessibleResources(),
      stripDuplicateRootIcons(),
      ...(analyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    // Service worker (MV3) не имеет document/window — Vite modulepreload polyfill
    // падает с ReferenceError на динамических import() в background.
    build: {
      modulePreload: false,
      esbuild: {
        drop: ['console', 'debugger'],
      },
    },
  };
});
