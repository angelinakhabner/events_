import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * The dev-preview build ships a DEV-marked variant of the app icon so the
 * browser tab, the bookmark and the installed PWA are distinguishable from
 * production at a glance. Both icon sets are committed under public/icons;
 * index.html references the production set, and this plugin rewrites those
 * references (plus the manifest and the tab title) when the build is the dev
 * one. Keeping production as the default means `npm run dev` and any build
 * without VITE_APP_VARIANT set behave exactly as before.
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
        .replace('<title>AFISZ</title>', '<title>AFISZ — dev</title>');
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), appVariantIcons(process.env.VITE_APP_VARIANT)],
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
