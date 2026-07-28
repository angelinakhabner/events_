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

// GOI-35. Unauthenticated by design — the per-subscription token in the link
// is the credential. Without DATABASE_URL the default store is in-memory, so
// every token is unknown; that is exactly the case worth pinning here, since
// an unknown token must never be treated as a success.
describe('newsletter unsubscribe', () => {
  it('answers 404 to a POST with an unknown token', async () => {
    const res = await createApp().request('/newsletter/unsubscribe?token=nope', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: 'unknown' });
  });

  it('answers 404 to a POST with no token at all', async () => {
    const res = await createApp().request('/newsletter/unsubscribe', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('redirects a GET to the SPA carrying the outcome', async () => {
    const res = await createApp().request('/newsletter/unsubscribe?token=nope');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/unsubscribe\?status=unknown$/);
  });

  it('needs no admin token, unlike /admin/*', async () => {
    const res = await createApp().request('/newsletter/unsubscribe?token=nope', { method: 'POST' });
    expect(res.status).not.toBe(401);
  });
});
