import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';

// Auth guard only — the happy path runs a real scrape (DB + Firecrawl/Claude)
// and is exercised manually / in integration. A missing token is always
// unauthorized regardless of whether ADMIN_TOKEN is configured, so these are
// robust without touching the DB.
describe('admin endpoints', () => {
  it('rejects /admin/venues without a token', async () => {
    const res = await createApp().request('/admin/venues');
    expect(res.status).toBe(401);
  });

  it('rejects /admin/scrape without a token', async () => {
    const res = await createApp().request('/admin/scrape/polin');
    expect(res.status).toBe(401);
  });

  it('rejects /admin/render without a token', async () => {
    const res = await createApp().request('/admin/render?url=https://example.com');
    expect(res.status).toBe(401);
  });

  // Guarded like the rest — it sends a real email, so an open version would be
  // a free relay for anyone who found the URL.
  it('rejects /admin/email-test without a token', async () => {
    const res = await createApp().request('/admin/email-test?to=someone@example.com');
    expect(res.status).toBe(401);
  });

  it('keeps /health open', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// Google sign-in is env-gated; the test env has no GOOGLE_* config, so both
// endpoints must answer 503 rather than redirect anywhere.
describe('google auth endpoints (unconfigured)', () => {
  it('reports /auth/google as not configured', async () => {
    const res = await createApp().request('/auth/google');
    expect(res.status).toBe(503);
  });

  it('reports /auth/google/callback as not configured', async () => {
    const res = await createApp().request('/auth/google/callback?code=x&state=y');
    expect(res.status).toBe(503);
  });
});

/**
 * The site is open to everyone.
 *
 * It used to sit behind a pre-auth invite gate (GOI-83) that answered 401 to
 * every path without a cookie. That gate is gone: anyone can reach the app and
 * sign in with their own email. These cases are the regression guard — a
 * middleware that starts denying anonymous visitors again breaks them.
 */
describe('open access', () => {
  it('answers an anonymous tRPC query', async () => {
    const res = await createApp().request('/trpc/health');
    expect(res.status).toBe(200);
  });

  it('tells an anonymous visitor how they can log in', async () => {
    const res = await createApp().request('/trpc/auth.methods');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: { magicLink: boolean } } };
    expect(body.result.data.magicLink).toBe(true);
  });

  it('has no invite exchange or gate-status route left', async () => {
    const app = createApp();
    for (const path of ['/gate', '/i/some-token']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('does not 401 an unknown path — nothing gates the router root', async () => {
    const res = await createApp().request('/anything/else');
    expect(res.status).toBe(404);
  });
});
