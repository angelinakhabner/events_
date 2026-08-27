import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { LANDING_CSS, LANDING_ID, LANDING_ROOT_CSS, landingBody, landingHead } from './src/landing/render';

const HEAD_MARKER = '<!--afisz:head-->';
const BODY_MARKER = '<!--afisz:landing-->';

/**
 * Bakes the public landing page into index.html (see src/landing/render.ts).
 *
 * The page has to be in the served document rather than rendered by the app:
 * the app is behind an invite gate, and a crawler that is handed an empty
 * #root and a bundle to run may never see a word of it. Doing it here means
 * one source of copy, the dev server and the build agreeing, and a page that
 * is complete before any JavaScript arrives.
 *
 * The /dev/ preview builds the same markup but must not compete with the real
 * page in search results, so it is marked noindex.
 */
function landingPlugin(): Plugin {
  return {
    name: 'afisz-landing',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const noindex = !!process.env.VITE_DEV_GATE_HASH;
        for (const marker of [HEAD_MARKER, BODY_MARKER]) {
          if (!html.includes(marker)) {
            // Failing the build is the point: silently shipping index.html
            // without the landing page is the exact regression this guards.
            throw new Error(`index.html is missing the ${marker} marker`);
          }
        }
        return html
          .replace(HEAD_MARKER, landingHead({ noindex }).join('\n    '))
          .replace(
            BODY_MARKER,
            `<style>${LANDING_CSS}${LANDING_ROOT_CSS}</style>\n    <div id="${LANDING_ID}">${landingBody()}</div>`,
          );
      },
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), landingPlugin()],
  resolve: {
    alias: {
      '@afisz/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/trpc': 'http://localhost:3001',
    },
  },
});
