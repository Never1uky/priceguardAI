import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifestJson from './manifest.json';

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

export default defineConfig({
  plugins: [react(), crx({ manifest: manifestJson }), serviceWorkerSafeVitePreload()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Service worker (MV3) не имеет document/window — Vite modulepreload polyfill
  // падает с ReferenceError на динамических import() в background.
  build: {
    modulePreload: false,
  },
});
