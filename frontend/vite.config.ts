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

/**
 * The dev-preview build ships a DEV-marked variant of the app icon so the
 * browser tab, the bookmark and the installed PWA are distinguishable from
 * production at a glance. Both icon sets are committed under public/icons;
 * index.html references the production set, and this plugin rewrites those
 * references when the build is the dev one. Keeping production as the default
 * means `npm run dev` and any build without VITE_APP_VARIANT set behave
 * exactly as before.
 *
 * It runs after landingPlugin (which is `pre`), so the title it prefixes is
 * whichever one landingHead generated — matched by shape rather than by text,
 * so changing the landing copy cannot silently drop the DEV marker.
 *
 * VITE_APP_VARIANT is set per build step in .github/workflows/deploy-frontend.yml.
 */
function appVariantIcons(variant: string | undefined): Plugin {
  return {
    name: 'afisz-app-variant-icons',
    transformIndexHtml(html) {
      if (variant !== 'dev') return html;
      return html
        .replace(/icons\/afisz-app-icon/g, 'icons/afisz-dev-app-icon')
        .replace('/manifest.webmanifest', '/manifest.dev.webmanifest')
        .replace(/<title>(.*?)<\/title>/, '<title>DEV · $1</title>');
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), landingPlugin(), appVariantIcons(process.env.VITE_APP_VARIANT)],
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
