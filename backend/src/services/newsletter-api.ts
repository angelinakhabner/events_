import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { env } from '../config.js';
import { defaultAuthStore, normalizeEmail, type AuthStore } from './auth.js';
import { defaultNewsletterStore, stripUserId, type NewsletterStore } from './newsletter-store.js';
import { newsletterConfigStatus, sendNewsletterBriefs } from './newsletter.js';
import { newsletterSaveInput } from './newsletter-input.js';

/**
 * The public newsletter API (GOI-87).
 *
 * Until now the newsletter had exactly one front door: tRPC procedures behind
 * a browser session, which only the SPA can realistically call. Anything else
 * that wanted to work with the newsletter — a signup form on another site, a
 * CRM syncing its list, a scheduler kicking off a send — had no way in short
 * of impersonating a logged-in user.
 *
 * So this is a plain REST/JSON surface, versioned under /api/v1, authenticated
 * with a static bearer key rather than a user session. It is deliberately
 * *not* tRPC: the whole point is that callers who know nothing about this
 * codebase's types can use it with curl.
 *
 * Two things follow from that and are worth stating outright:
 *
 *  - It is mounted BEFORE the invite gate (see app.ts). The gate exists to
 *    keep the work-in-progress SPA out of public view; applying it here would
 *    make the API unusable by the very services it exists for, since they hold
 *    no invite cookie.
 *  - It is off unless NEWSLETTER_API_KEY is set. An unset key means every
 *    route answers 503, so a deploy that forgets to configure one exposes
 *    nothing rather than everything.
 *
 * Subscriptions are keyed by email address, not by the internal user id. That
 * is the identifier an outside service actually holds, and it keeps user ids
 * — which are also session-adjacent — out of a third party's database.
 */

export interface NewsletterApiDeps {
  auth: AuthStore;
  newsletter: NewsletterStore;
  /** Injectable so tests can drive a sweep without a database or Resend. */
  send: typeof sendNewsletterBriefs;
}

const defaultDeps = (): NewsletterApiDeps => ({
  auth: defaultAuthStore,
  newsletter: defaultNewsletterStore,
  send: sendNewsletterBriefs,
});

/** Whether the API is configured at all. */
export function newsletterApiEnabled(): boolean {
  return !!env.NEWSLETTER_API_KEY;
}

/**
 * Constant-time bearer check.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * key's length, so the lengths are compared first and a mismatch simply fails
 * — the same answer an equal-length wrong key gets.
 */
export function keyMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The bearer token on a request, or null when the header is absent/malformed. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

function apiAuth(): MiddlewareHandler {
  return async (c, next) => {
    const key = env.NEWSLETTER_API_KEY;
    if (!key) {
      return c.json(
        { error: 'The newsletter API is not enabled on this deployment (NEWSLETTER_API_KEY is unset).' },
        503,
      );
    }
    const presented = bearerToken(c.req.header('authorization'));
    if (!presented || !keyMatches(presented, key)) {
      return c.json({ error: 'Unauthorized — pass "Authorization: Bearer <NEWSLETTER_API_KEY>".' }, 401);
    }
    await next();
  };
}

/** Zod's report, flattened into something a curl user can act on. */
function badRequest(err: ZodError) {
  return {
    error: 'Invalid subscription payload.',
    issues: err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
  };
}

/**
 * The public representation of a subscription.
 *
 * `userId` is deliberately absent — see the note above. Callers address a
 * subscription by the email they already know.
 */
function publicView(email: string, settings: Awaited<ReturnType<NewsletterStore['get']>>) {
  if (!settings) return null;
  return { email, subscription: settings };
}

export function createNewsletterApi(deps: NewsletterApiDeps = defaultDeps()) {
  const api = new Hono();

  api.use('*', apiAuth());

  /**
   * Whether this deployment can actually deliver, and how it is scheduled.
   * The first call an integrator should make: it distinguishes "my key is
   * wrong" from "this environment sends no email at all".
   */
  api.get('/status', (c) => c.json({ ok: true, ...newsletterConfigStatus() }));

  /** Every enabled subscription. The work list the sender itself reads. */
  api.get('/subscriptions', async (c) => {
    const subs = await deps.newsletter.listEnabled();
    return c.json({
      count: subs.length,
      subscriptions: subs.map((s) => ({ email: s.email, subscription: stripUserId(s) })),
    });
  });

  /** One subscription by email. 404 when the address has no account or no
   *  subscription — an outside caller cannot tell those apart, and shouldn't:
   *  the difference is a membership disclosure. */
  api.get('/subscriptions/:email', async (c) => {
    const email = normalizeEmail(decodeURIComponent(c.req.param('email')));
    const user = await deps.auth.findUserByEmail(email);
    const settings = user ? await deps.newsletter.get(user.id) : null;
    const view = publicView(email, settings);
    if (!view) return c.json({ error: `No newsletter subscription for ${email}.` }, 404);
    return c.json(view);
  });

  /**
   * Create or replace a subscription.
   *
   * The address in the body is both the account key and the delivery address,
   * matching the app: you subscribe yourself. An address with no account yet
   * gets one — that is what lets an external signup form work end to end, and
   * it mints no session, so it grants the caller no way to act *as* that user.
   */
  api.post('/subscriptions', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be JSON.' }, 400);
    }
    const parsed = newsletterSaveInput.safeParse(body);
    if (!parsed.success) return c.json(badRequest(parsed.error), 400);

    const email = normalizeEmail(parsed.data.email);
    const user = await deps.auth.upsertUser(email);
    const settings = await deps.newsletter.save(user.id, { ...parsed.data, email });
    return c.json({ email, subscription: settings });
  });

  /**
   * Unsubscribe: disable rather than delete.
   *
   * The row carries `lastSentAt` and the reader's whole configuration, so
   * dropping it would turn a resubscribe into "set everything up again" and
   * would lose the send history that makes double-sends detectable. Idempotent
   * — unsubscribing twice is a 200 both times, which is what a retrying
   * integration needs.
   */
  api.delete('/subscriptions/:email', async (c) => {
    const email = normalizeEmail(decodeURIComponent(c.req.param('email')));
    const user = await deps.auth.findUserByEmail(email);
    const existing = user ? await deps.newsletter.get(user.id) : null;
    if (!user || !existing) return c.json({ error: `No newsletter subscription for ${email}.` }, 404);
    const settings = await deps.newsletter.save(user.id, { ...existing, enabled: false });
    return c.json({ email, subscription: settings });
  });

  /**
   * Run a send sweep now.
   *
   * `dryRun` reports exactly what would happen and sends nothing — the safe
   * call for a caller wiring this up for the first time. `force` ignores the
   * schedule, and `only` restricts to one subscriber (by email or user id).
   * Without any of them this is the same sweep the in-process scheduler runs,
   * which is what lets an external cron replace it.
   */
  api.post('/send', async (c) => {
    let body: Record<string, unknown> = {};
    if (c.req.header('content-type')?.includes('application/json')) {
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        return c.json({ error: 'Body must be JSON.' }, 400);
      }
    }
    const only = typeof body.only === 'string' ? body.only : undefined;
    const sweep = await deps.send(deps.newsletter, new Date(), {
      dryRun: body.dryRun === true,
      force: body.force === true,
      only,
    });
    return c.json({ dryRun: body.dryRun === true, ...sweep });
  });

  return api;
}
