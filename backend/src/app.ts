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
import { createNewsletterApi } from './services/newsletter-api.js';
import { newsletterFromEmail, sendEmail } from './services/email.js';
import {
  exchangeGoogleCode,
  googleAuthConfig,
  googleAuthUrl,
  makeState,
  readSignedState,
  verifyState,
} from './services/google-auth.js';
import {
  driveAccountEmail,
  exchangeDriveCode,
  googleDriveConfig,
  googleDriveProvider,
} from './services/google-drive.js';
import { defaultDriveStore } from './services/drive-store.js';
import { NOINDEX, ROBOTS_TXT } from './services/robots.js';

export function createApp() {
  const app = new Hono();

  // CORS is pinned to known origins rather than `*`: the SPA is the only
  // intended caller, and a session bearer token has no business being sent
  // from a page we don't serve. The allowlist is the configured app plus the
  // local dev servers.
  const allowedOrigins = [
    env.APP_URL.replace(/\/$/, ''),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]!),
      credentials: true,
    }),
  );

  // Off search engines entirely, on every route. A header rather than a meta
  // tag so it also covers the JSON endpoints. See services/robots.ts — this is
  // now the only thing left of the old invite gate's "keep it unlisted" half.
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Robots-Tag', NOINDEX);
  });
  app.get('/robots.txt', (c) => c.text(ROBOTS_TXT));

  // ─── Public newsletter API (GOI-87) ───────────────────────────────────────
  // Carries its own bearer-key auth and is inert until NEWSLETTER_API_KEY is
  // set — the services it exists for are machines, not logged-in people.
  app.route('/api/v1/newsletter', createNewsletterApi());

  // The site is open: anyone can reach it and sign in (magic link or Google).
  // Nothing stands in front of the routes below. What is private is private
  // per-procedure instead — see userProcedure/ownerProcedure in trpc/trpc.ts,
  // which is where a caller's own lists, venues and newsletter live.
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

  /**
   * Completing a Google Drive connection (GOI-91).
   *
   * There is no matching `/auth/google/drive` start route: the consent URL is
   * minted by the `my.newsletter.drive.connectUrl` procedure, which already has
   * the caller's session and can bind their user id into the signed state. A
   * start route here would have to take the session in a query string, putting
   * a live bearer token into browser history, referrers and access logs.
   */
  app.get('/auth/google/drive/callback', async (c) => {
    const cfg = googleDriveConfig();
    const appUrl = env.APP_URL.replace(/\/$/, '');
    const back = (params: string) => c.redirect(`${appUrl}/my?section=newsletter#${params}`);
    const fail = (msg: string) => back(`drive=error&message=${encodeURIComponent(msg)}`);

    if (!cfg) return fail('Google Drive is not configured on this deployment.');

    const state = c.req.query('state') ?? '';
    const userId = readSignedState(state, cfg.clientSecret);
    if (!userId) return fail('That connection attempt expired — please try again.');
    if (c.req.query('error')) return fail('Connecting Google Drive was cancelled.');
    const code = c.req.query('code');
    if (!code) return fail('Connecting Google Drive failed (missing code).');

    try {
      const tokens = await exchangeDriveCode(cfg, code);
      await defaultDriveStore.connect(userId, {
        provider: 'google',
        refreshToken: tokens.refreshToken,
        accountEmail: tokens.email ?? (await driveAccountEmail(tokens.accessToken)),
      });
      // The folder is created now rather than on the first send, so the user
      // can see it exists before waiting a day for a brief to prove it.
      try {
        const credentials = await defaultDriveStore.credentials(userId, 'google');
        if (credentials) {
          const folder = await googleDriveProvider.ensureFolder({
            refreshToken: credentials.refreshToken,
            folderName: credentials.folderName,
            knownFolderId: credentials.folderId,
          });
          await defaultDriveStore.rememberFolder(userId, 'google', folder.folderId);
        }
      } catch (e) {
        // The connection itself is good; the folder is retried on first send.
        console.warn('[drive] folder setup after connect failed:', e instanceof Error ? e.message : e);
      }
      return back('drive=connected');
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Connecting Google Drive failed.');
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
  // one): run a real sweep now instead of waiting for the next tick.
  //   ?force=1           ignore the schedule — brief everyone who has events
  //   ?user=<id|email>   restrict to one subscriber
  // For "does Resend work at all", use /admin/email-test below — it isolates
  // delivery from brief selection.
  app.get('/admin/newsletter/send', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const sweep = await sendNewsletterBriefs(undefined, new Date(), {
      force: c.req.query('force') === '1',
      only: c.req.query('user'),
    });
    return c.json({ config: newsletterConfigStatus(), ...sweep });
  });

  // GET /admin/email-test?to=<address>&token=...  — send one real email through
  // Resend and report verbatim what Resend answered. "The login link never
  // arrives for X" is otherwise invisible from the outside: the SPA shows a
  // generic failure and the provider's reason is buried in the deploy logs.
  //
  // The reason that matters most: on an unverified sending domain Resend only
  // delivers to the Resend account's own address and refuses every other
  // recipient, so the owner's inbox works while every tester's silently doesn't.
  app.get('/admin/email-test', async (c) => {
    if (!authorized(c.req.query('token'))) return c.json({ error: 'unauthorized' }, 401);
    const to = c.req.query('to');
    if (!to) return c.json({ error: 'pass ?to=<recipient address>' }, 400);
    // The two senders are verified independently as far as a recipient's spam
    // filter is concerned, so the check has to be able to exercise either.
    const from = c.req.query('sender') === 'newsletter' ? newsletterFromEmail() : env.RESEND_FROM_EMAIL;
    if (!env.RESEND_API_KEY) {
      return c.json(
        { ok: false, to, from, error: 'RESEND_API_KEY is not set — this deploy sends no email at all' },
        400,
      );
    }

    try {
      const { id } = await sendEmail({
        to,
        from,
        subject: 'AFISZ deliverability check',
        html: '<p>This is a deliverability check from AFISZ. Nothing to do — if you can read it, sign-in emails reach this address.</p>',
      });
      return c.json({ ok: true, to, from, id });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Resend phrases the unverified-domain refusal as "you can only send
      // testing emails to your own email address" — worth naming outright,
      // since the fix (verify the domain) isn't obvious from the message.
      const hint = /own email address|not verified|domain/i.test(error)
        ? `The domain of ${from} is not verified in Resend, so Resend refuses every recipient except the Resend account's own address. Verify the sending domain in Resend → Domains (DNS records), then set RESEND_FROM_EMAIL (or NEWSLETTER_FROM_EMAIL) to an address on it.`
        : undefined;
      return c.json({ ok: false, to, from, error, ...(hint ? { hint } : {}) }, 502);
    }
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
