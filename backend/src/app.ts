import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { env } from './config.js';
import { getDb, schema } from './db/index.js';
import { scrapeVenue } from './services/scraper/runner.js';
import { firecrawlScrape } from './services/scraper/fetcher.js';
import { defaultAuthStore, loginWithVerifiedEmail } from './services/auth.js';
import { newsletterConfigStatus, sendNewsletterBriefs } from './services/newsletter.js';
import { sendEmail } from './services/email.js';
import {
  exchangeGoogleCode,
  googleAuthConfig,
  googleAuthUrl,
  makeState,
  verifyState,
} from './services/google-auth.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors({ origin: '*' }));

  app.get('/health', (c) => c.json({ ok: true }));

  // ─── "Sign in with Google" ────────────────────────────────────────────────
  // Plain OIDC code flow; enabled only when GOOGLE_CLIENT_ID/SECRET and
  // API_PUBLIC_URL are configured (frontend hides the button otherwise via
  // auth.methods). The session token travels back to the SPA in the URL
  // fragment — fragments never reach servers or access logs.

  app.get('/auth/google', (c) => {
    const cfg = googleAuthConfig();
    if (!cfg) return c.json({ error: 'Google sign-in is not configured' }, 503);
    return c.redirect(googleAuthUrl(cfg, makeState(cfg.clientSecret)));
  });

  app.get('/auth/google/callback', async (c) => {
    const cfg = googleAuthConfig();
    if (!cfg) return c.json({ error: 'Google sign-in is not configured' }, 503);
    const appUrl = env.APP_URL.replace(/\/$/, '');
    const fail = (msg: string) => c.redirect(`${appUrl}/auth#error=${encodeURIComponent(msg)}`);

    const state = c.req.query('state') ?? '';
    if (!verifyState(state, cfg.clientSecret)) return fail('Login attempt expired — please try again.');
    // The user declined on Google's screen, or Google reported an error.
    const providerError = c.req.query('error');
    if (providerError) return fail('Google sign-in was cancelled.');
    const code = c.req.query('code');
    if (!code) return fail('Google sign-in failed (missing code).');

    try {
      const { email } = await exchangeGoogleCode(cfg, code);
      const { sessionToken } = await loginWithVerifiedEmail(defaultAuthStore, email);
      return c.redirect(`${appUrl}/auth#session=${encodeURIComponent(sessionToken)}`);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Google sign-in failed.');
    }
  });

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

  // GET /admin/render?url=...&find=<text>  — render a URL through Firecrawl and
  // report what's actually in the DOM, without running extraction. Used to find
  // where data lives (e.g. are Kinoteka's showtimes in the rendered HTML, or
  // loaded later by JS?). Returns a compact summary, not the raw page.
  app.get('/admin/render', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'pass ?url=<page to render>' }, 400);
    if (!env.FIRECRAWL_API_KEY) return c.json({ error: 'FIRECRAWL_API_KEY not set' }, 400);

    let html: string;
    try {
      html = await firecrawlScrape(url, { apiKey: env.FIRECRAWL_API_KEY, apiUrl: env.FIRECRAWL_API_URL });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }

    const times = html.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) ?? [];
    const summary: Record<string, unknown> = {
      url,
      length: html.length,
      // If the rendered DOM has lots of HH:MM, showtimes ARE present (extraction
      // problem). If ~0, they're loaded later / behind interaction (data problem).
      clockTimeCount: times.length,
      sampleTimes: [...new Set(times)].slice(0, 30),
      hasNextData: html.includes('__NEXT_DATA__'),
      hasJsonLd: html.includes('application/ld+json'),
    };

    // Optional: return up to 5 context snippets around a search term, so we can
    // locate showtimes/markers in the DOM (e.g. ?find=seans or ?find=18:30).
    const find = c.req.query('find');
    if (find) {
      const lower = html.toLowerCase();
      const needle = find.toLowerCase();
      const snippets: string[] = [];
      for (let i = lower.indexOf(needle); i !== -1 && snippets.length < 5; i = lower.indexOf(needle, i + 1)) {
        snippets.push(html.slice(Math.max(0, i - 160), i + 160));
      }
      summary.find = { needle: find, matches: snippets.length, snippets };
    }
    return c.json(summary);
  });

  // GET /admin/newsletter?token=...  — why briefs are or aren't going out.
  // Reports the config the sender needs (cron flag, DB, Resend key) and then
  // dry-runs the sweep: for every enabled subscription, whether it's due, when
  // its last slot was, and how many events its filters actually match. Sends
  // nothing and records nothing.
  app.get('/admin/newsletter', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const config = newsletterConfigStatus();
    const sweep = await sendNewsletterBriefs(undefined, new Date(), {
      dryRun: true,
      force: c.req.query('force') === '1',
      only: c.req.query('user'),
    });
    return c.json({ config, now: new Date().toISOString(), ...sweep });
  });

  // POST-ish debug trigger (GET so it's browser-checkable, same as the scrape
  // one): run a real sweep now instead of waiting for the next hourly tick.
  //   ?force=1     ignore the schedule — brief everyone who has events
  //   ?user=<id|email>   restrict to one subscriber
  //   ?to=<email>  skip briefs entirely and send a fixed test email, which is
  //                the quickest way to tell a Resend/domain problem apart from
  //                an empty-brief one.
  app.get('/admin/newsletter/send', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const to = c.req.query('to');
    if (to) {
      try {
        const sent = await sendEmail({
          to,
          subject: 'Goin — newsletter test',
          html: '<p>Test email from the Goin backend. If this arrived, Resend and the sending domain are configured correctly.</p>',
        });
        return c.json({ test: { to, id: sent.id, from: env.RESEND_FROM_EMAIL } });
      } catch (e) {
        return c.json({ test: { to, error: e instanceof Error ? e.message : String(e) } }, 502);
      }
    }
    const sweep = await sendNewsletterBriefs(undefined, new Date(), {
      force: c.req.query('force') === '1',
      only: c.req.query('user'),
    });
    return c.json({ config: newsletterConfigStatus(), ...sweep });
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
