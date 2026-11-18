import { Hono } from 'hono';
import type { Context } from 'hono';
import { bearerToken } from './newsletter-api.js';
import { defaultNewsletterStore, type NewsletterStore } from './newsletter-store.js';
import { newsletterSaveInput } from './newsletter-input.js';
import { renderNewsletterPdf } from './newsletter-design.js';
import { buildNewsletterIssue, issueJson, type NewsletterIssueDeps } from './newsletter-issue.js';
import { defaultNewsletterKeyStore, type NewsletterKeyStore } from './newsletter-key-store.js';
import { defaultUserVenueStore } from './user-venue-store.js';
import { defaultWantToGoStore } from './want-to-go-store.js';
import { defaultFilmStore } from './film-store.js';

/**
 * One newsletter's issue, for an outside service (GOI-152).
 *
 * The reader generates a key in the newsletter section; a service such as
 * printed.sh then calls
 *
 *   GET /api/v1/issue/latest.pdf    the print-ready PDF, in the chosen design
 *   GET /api/v1/issue/latest.json   the same issue as structured data
 *
 * with `Authorization: Bearer <key>`. The key names the newsletter, so there
 * is no id in the URL and one key can never open another reader's issue.
 *
 * Distinct from the admin API under /api/v1/newsletter (GOI-87), which takes
 * one deployment-wide key and manages every subscription. That key must never
 * be handed to a third party; this one is scoped to a single newsletter and can
 * be revoked by its reader.
 *
 * "Latest" is the issue as it stands right now — exactly what Generate shows.
 * It records no send state, so fetching it any number of times does not stop
 * the scheduled email or drive copy from carrying the same events.
 *
 * Mounted above the invite gate (app.ts), for the same reason the admin API is:
 * the services that call it hold no invite cookie.
 */

export interface NewsletterIssueApiDeps extends NewsletterIssueDeps {
  keys: NewsletterKeyStore;
  newsletter: NewsletterStore;
  /** Injectable so tests need not draw a real PDF. */
  renderPdf: typeof renderNewsletterPdf;
}

const defaultDeps = (): NewsletterIssueApiDeps => ({
  keys: defaultNewsletterKeyStore,
  newsletter: defaultNewsletterStore,
  userVenues: defaultUserVenueStore,
  wantToGo: defaultWantToGoStore,
  films: defaultFilmStore,
  renderPdf: renderNewsletterPdf,
});

const UNAUTHORIZED = {
  error: 'Unauthorized — pass "Authorization: Bearer <key>" with the key from your newsletter settings.',
};

export function createNewsletterIssueApi(deps: NewsletterIssueApiDeps = defaultDeps()) {
  const api = new Hono();

  /** The newsletter a request's key opens, its settings, and the issue built
   *  from them — or the response to send instead. */
  async function load(c: Context) {
    const key = bearerToken(c.req.header('authorization'));
    const owner = key ? await deps.keys.resolve(key) : null;
    if (!owner) return { response: c.json(UNAUTHORIZED, 401) } as const;

    const settings = await deps.newsletter.getById(owner.userId, owner.configId);
    // The key row cascades with its newsletter, so this is a race at most.
    if (!settings) return { response: c.json({ error: 'This newsletter no longer exists.' }, 404) } as const;

    // Stored settings went through the same schema when saved; re-parsing
    // fills defaults for fields added since, as the sender would see them.
    const parsed = newsletterSaveInput.safeParse(settings);
    if (!parsed.success) {
      return {
        response: c.json({ error: 'This newsletter’s settings are incomplete. Open and save it in the app.' }, 422),
      } as const;
    }
    const issue = await buildNewsletterIssue(owner.userId, parsed.data, deps);
    return { settings, issue } as const;
  }

  // Never cached by a proxy in between: the issue changes as events are
  // scraped, and it is one reader's.
  api.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  });

  api.get('/latest.json', async (c) => {
    const r = await load(c);
    if ('response' in r) return r.response;
    return c.json(issueJson(r.settings, r.issue));
  });

  api.get('/latest.pdf', async (c) => {
    const r = await load(c);
    if ('response' in r) return r.response;
    const pdf = await deps.renderPdf(r.issue.brief);
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${r.issue.pdfFilename.replace(/"/g, '')}"`,
    });
  });

  return api;
}
