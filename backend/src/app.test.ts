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

  it('keeps /health open', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
