import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from './app.js';
import { appRouter } from './trpc/router.js';
import { COOKIE_NAME, hashToken, mintToken } from './services/invite-gate.js';

/**
 * The gate as the outside world meets it (GOI-83): the real Hono router, the
 * real middleware order, every tRPC procedure.
 *
 * The invites table is stubbed rather than mocked per-test, so the assertions
 * are about the middleware's behaviour and not about drizzle.
 */

// One row per state, keyed by hash. `isTokenValid` reads exactly this shape.
const rows = new Map<string, {
  tokenHash: string; label: string; createdAt: Date;
  expiresAt: Date | null; revokedAt: Date | null;
  lastUsedAt: Date | null; useCount: number;
}>();

vi.mock('./db/index.js', () => ({
  schema: { invites: { tokenHash: 'token_hash', useCount: 'use_count' } },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (cond: { hash?: string }) => ({
          limit: async () => {
            const row = rows.get(cond?.hash ?? '');
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

// drizzle's `eq` is opaque; carry the hash through so the fake store can read it.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, eq: (_col: unknown, value: string) => ({ hash: value }) };
});

const VALID = mintToken();
const REVOKED = mintToken();
const EXPIRED = mintToken();

function seed() {
  rows.clear();
  const base = { label: 'test', createdAt: new Date(), lastUsedAt: null, useCount: 0 };
  rows.set(hashToken(VALID), { ...base, tokenHash: hashToken(VALID), expiresAt: null, revokedAt: null });
  rows.set(hashToken(REVOKED), {
    ...base, tokenHash: hashToken(REVOKED), expiresAt: null, revokedAt: new Date('2020-01-01'),
  });
  rows.set(hashToken(EXPIRED), {
    ...base, tokenHash: hashToken(EXPIRED), expiresAt: new Date('2020-01-01'), revokedAt: null,
  });
}

const cookie = (token: string) => ({ cookie: `${COOKIE_NAME}=${token}` });

beforeEach(() => {
  seed();
  vi.stubEnv('INVITE_GATE_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('deny by default', () => {
  /**
   * The assertion the ticket asks for by name: enumerate the router and check
   * every procedure, including ones the UI never calls. A single ungated
   * procedure hands over the dataset as JSON regardless of what the frontend
   * renders — so this must be derived from the router, not a hand-written list
   * that goes stale the next time someone adds an endpoint.
   */
  const procedures = Object.keys(
    (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
  );

  it('finds the procedures to check', () => {
    expect(procedures.length).toBeGreaterThan(20);
  });

  it.each(procedures)('denies /trpc/%s without a cookie', async (path) => {
    const res = await createApp().request(`/trpc/${path}`);
    expect(res.status).toBe(401);
  });

  it.each(['/', '/admin/venues', '/auth/google', '/anything/else'])(
    'denies %s without a cookie',
    async (path) => {
      const res = await createApp().request(path);
      expect(res.status).toBe(401);
    },
  );

  it('allows only the documented public paths', async () => {
    const app = createApp();
    for (const path of ['/health', '/gate', '/robots.txt']) {
      expect((await app.request(path)).status).toBe(200);
    }
  });
});

/**
 * The public newsletter API (GOI-87) is mounted deliberately *above* the gate.
 *
 * The gate keeps the unfinished SPA out of public view, but the services this
 * API exists for hold no invite cookie — gating it would make it unusable for
 * its only purpose. What replaces the gate is its own bearer key. That key's
 * behaviour is covered in services/newsletter-api.test.ts, which mocks config
 * and can therefore vary it; the only thing provable here — and the thing that
 * breaks silently if someone moves the `app.route` call below `inviteGate()` —
 * is that these requests reach the API at all.
 */
describe('the newsletter API is mounted outside the gate', () => {
  const paths = [
    '/api/v1/newsletter/status',
    '/api/v1/newsletter/subscriptions',
    '/api/v1/newsletter/subscriptions/ada%40example.com',
  ];

  // 503 is the API answering "no NEWSLETTER_API_KEY on this deploy" — none is
  // set in the test env. The gate's answer would be 401, so a 503 is what
  // shows the gate never ran. It is never 200: an unset key means closed.
  it.each(paths)('answers %s itself rather than 401ing at the gate', async (path) => {
    const res = await createApp().request(path);
    expect(res.status).toBe(503);
  });
});

describe('exchanging an invite', () => {
  it('sets an httpOnly cookie and redirects to the app', async () => {
    const res = await createApp().request(`/i/${VALID}`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(res.status).toBe(302);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${COOKIE_NAME}=${VALID}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=None');
  });

  it('lets the cookie through on every subsequent request — it is a shared link', async () => {
    const app = createApp();
    // Not /admin/* — those answer 401 for a missing ADMIN_TOKEN whatever the
    // gate does, so they can't show the cookie was accepted.
    for (const path of ['/trpc/health', '/trpc/events.listDefault', '/health']) {
      const res = await app.request(path, { headers: cookie(VALID) });
      expect(res.status).not.toBe(401);
    }
  });

  it('stays valid across repeated exchanges, rather than burning on first use', async () => {
    const app = createApp();
    for (let i = 0; i < 3; i++) {
      expect((await app.request(`/i/${VALID}`)).status).toBe(302);
    }
  });
});

describe('failures are indistinguishable', () => {
  const bad = () => [
    ['revoked', REVOKED],
    ['expired', EXPIRED],
    ['never existed', mintToken()],
    ['garbage', 'not-a-token'],
    ['truncated', VALID.slice(0, 20)],
    ['wrong length', VALID + 'x'],
  ] as const;

  it.each(bad())('rejects a %s token', async (_label, token) => {
    const res = await createApp().request(`/i/${token}`);
    expect(res.status).toBe(404);
  });

  // Nothing may reveal whether a token ever existed, or which way it failed.
  it('returns byte-identical responses for every failure mode', async () => {
    const app = createApp();
    const bodies = new Set<string>();
    const statuses = new Set<number>();
    for (const [, token] of bad()) {
      const res = await app.request(`/i/${token}`);
      statuses.add(res.status);
      bodies.add(await res.text());
    }
    expect(statuses.size).toBe(1);
    expect(bodies.size).toBe(1);
  });

  // Revocation that only applied at exchange time would leave every cookie
  // already minted from the link working for the rest of its 90 days.
  it('rejects a cookie minted from a token that was revoked afterwards', async () => {
    const app = createApp();
    // It worked before revocation…
    rows.get(hashToken(REVOKED))!.revokedAt = null;
    expect((await app.request('/trpc/health', { headers: cookie(REVOKED) })).status).not.toBe(401);
    // …and stops the moment it is revoked, without re-exchange.
    rows.get(hashToken(REVOKED))!.revokedAt = new Date();
    expect((await app.request('/trpc/health', { headers: cookie(REVOKED) })).status).toBe(401);
  });

  it('rejects a cookie carrying an expired token', async () => {
    const res = await createApp().request('/trpc/health', { headers: cookie(EXPIRED) });
    expect(res.status).toBe(401);
  });

  it('does not throw on a hostile cookie value', async () => {
    const app = createApp();
    for (const value of ['', '../../etc/passwd', 'a'.repeat(4000), '%00']) {
      const res = await app.request('/trpc/health', { headers: { cookie: `${COOKIE_NAME}=${value}` } });
      expect(res.status).toBe(401);
    }
  });
});

describe('the kill switch', () => {
  it('passes everything through when INVITE_GATE_ENABLED=false', async () => {
    vi.stubEnv('INVITE_GATE_ENABLED', 'false');
    const app = createApp();
    expect((await app.request('/trpc/health')).status).toBe(200);
    expect((await app.request('/gate')).status).toBe(200);
    expect(await (await app.request('/gate')).json()).toEqual({ open: true });
  });

  it('is closed by default — an unset flag must not open the site', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('INVITE_GATE_ENABLED', '');
    const res = await createApp().request('/trpc/health');
    expect(res.status).toBe(401);
  });
});

describe('/gate reports whether this browser holds an invite', () => {
  it('is false with no cookie', async () => {
    const res = await createApp().request('/gate');
    expect(await res.json()).toEqual({ open: false });
  });

  it('is true with a valid one', async () => {
    const res = await createApp().request('/gate', { headers: cookie(VALID) });
    expect(await res.json()).toEqual({ open: true });
  });

  it('is false with a revoked one', async () => {
    const res = await createApp().request('/gate', { headers: cookie(REVOKED) });
    expect(await res.json()).toEqual({ open: false });
  });
});

describe('search engines', () => {
  it('sends noindex on the gate page and on app responses alike', async () => {
    const app = createApp();
    const gated = await app.request('/trpc/health');
    const open = await app.request('/trpc/health', { headers: cookie(VALID) });
    const invite = await app.request(`/i/${VALID}`);

    for (const res of [gated, open, invite]) {
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(res.headers.get('x-robots-tag')).toContain('nofollow');
    }
  });

  it('disallows everything in robots.txt, without a cookie', async () => {
    const res = await createApp().request('/robots.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Disallow: /');
  });
});

describe('storage', () => {
  // A dump of the table must hand an attacker nothing usable.
  it('stores the hash and never the token', () => {
    const stored = [...rows.values()];
    const serialized = JSON.stringify(stored);
    for (const token of [VALID, REVOKED, EXPIRED]) {
      expect(serialized).not.toContain(token);
      expect(stored.some((r) => r.tokenHash === hashToken(token))).toBe(true);
    }
  });
});
