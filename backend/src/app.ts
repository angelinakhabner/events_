import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { env } from './config.js';
import { getDb, schema } from './db/index.js';
import { scrapeVenue } from './services/scraper/runner.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({ origin: '*' }));

  app.get('/health', (c) => c.json({ ok: true }));

  // ─── Admin debug endpoints ────────────────────────────────────────────────
  // Browser-checkable, no script needed. Disabled unless ADMIN_TOKEN is set;
  // callers pass ?token=<ADMIN_TOKEN>. Handy for confirming a deploy works
  // (e.g. Firecrawl rendering) and re-scraping a single venue on demand.
  const authorized = (token: string | undefined): boolean =>
    !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;

  app.get('/admin/venues', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const db = getDb();
    const rows = await db.select().from(schema.venues);
    return c.json({
      venues: rows
        .map((v) => ({ id: v.id, name: v.name, url: v.url, category: v.category }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  // GET /admin/scrape/:q?token=...  — q matches a venue id or a name substring.
  // Runs the full pipeline (incl. Firecrawl render when configured) and returns
  // the run result. Slow (~10-60s) — it's a manual debug call.
  app.get('/admin/scrape/:q', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const q = decodeURIComponent(c.req.param('q')).toLowerCase();
    const db = getDb();
    const all = await db.select().from(schema.venues);
    const venue = all.find((v) => v.id === q || v.name.toLowerCase().includes(q));
    if (!venue) {
      return c.json({ error: `no venue matching "${q}"`, hint: 'GET /admin/venues for the list' }, 404);
    }
    const run = await scrapeVenue(venue.id, {});
    return c.json({
      venue: { id: venue.id, name: venue.name, url: venue.url },
      run: { status: run.status, eventsFound: run.eventsFound, errorMessage: run.errorMessage },
    });
  });

  app.use(
    '/trpc/*',
    trpcServer({
      router: appRouter,
      createContext: createContext as never,
      endpoint: '/trpc',
    }),
  );

  return app;
}

export type App = ReturnType<typeof createApp>;
