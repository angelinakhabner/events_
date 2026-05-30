import { describe, it, expect } from 'vitest';
import { createApp } from '../../app.js';

const app = createApp();

async function call(path: string, init?: RequestInit) {
  const res = await app.request(`http://localhost${path}`, init);
  return { status: res.status, body: await res.json() as unknown };
}

describe('API integration', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await call('/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('tRPC getVenues returns default Warsaw venues', async () => {
    const { status, body } = await call('/trpc/getVenues');
    expect(status).toBe(200);
    const data = (body as { result: { data: unknown[] } }).result.data;
    expect(Array.isArray(data)).toBe(true);
    expect((data as { city: string }[]).every((v) => v.city === 'Warsaw')).toBe(true);
  });

  it('tRPC getVenues filters by category', async () => {
    const input = encodeURIComponent(JSON.stringify({ category: 'cinema' }));
    const { status, body } = await call(`/trpc/getVenues?input=${input}`);
    expect(status).toBe(200);
    const data = (body as { result: { data: { category: string }[] } }).result.data;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((v) => v.category === 'cinema')).toBe(true);
  });
});
