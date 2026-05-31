import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app.js';
import { defaultFolderStore } from '../../services/folder-store.js';

const app = createApp();

interface TrpcEnvelope<T> { result: { data: T } }

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(`http://localhost${path}`, init);
  return { status: res.status, body: (await res.json()) as T };
}

function trpcInput(obj: unknown): string {
  return encodeURIComponent(JSON.stringify(obj));
}

beforeEach(() => {
  // Reset the in-memory folder store between tests for isolation.
  defaultFolderStore.list().forEach((f) => defaultFolderStore.delete(f.id));
});

describe('API integration', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await call<{ ok: boolean }>('/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('venues.list returns the default Warsaw seed', async () => {
    const { status, body } = await call<TrpcEnvelope<{ city: string }[]>>('/trpc/venues.list');
    expect(status).toBe(200);
    expect(body.result.data.length).toBeGreaterThan(0);
    expect(body.result.data.every((v) => v.city === 'Warsaw')).toBe(true);
  });

  it('venues.list filters by category', async () => {
    const { body } = await call<TrpcEnvelope<{ category: string }[]>>(
      `/trpc/venues.list?input=${trpcInput({ category: 'cinema' })}`,
    );
    expect(body.result.data.every((v) => v.category === 'cinema')).toBe(true);
  });

  it('events.listDefault returns events and respects category filter', async () => {
    const { body: all } = await call<TrpcEnvelope<{ id: string }[]>>('/trpc/events.listDefault');
    expect(all.result.data.length).toBeGreaterThan(0);

    const { body: filtered } = await call<TrpcEnvelope<{ venueId: string }[]>>(
      `/trpc/events.listDefault?input=${trpcInput({ filters: { categories: ['cinema'] } })}`,
    );
    expect(filtered.result.data.every((e) => e.venueId === 'kino-muranow')).toBe(true);
  });

  it('folders CRUD: listMine → create → update → getEvents → delete', async () => {
    const listEmpty = await call<TrpcEnvelope<unknown[]>>('/trpc/folders.listMine');
    expect(listEmpty.body.result.data).toEqual([]);

    const created = await call<TrpcEnvelope<{ id: string; name: string }>>(
      '/trpc/folders.create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Weeknight cinema', venueIds: ['kino-muranow'], filters: { categories: ['cinema'] } }),
      },
    );
    expect(created.status).toBe(200);
    const id = created.body.result.data.id;
    expect(created.body.result.data.name).toBe('Weeknight cinema');

    const renamed = await call<TrpcEnvelope<{ name: string }>>('/trpc/folders.update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: 'Cinema picks' }),
    });
    expect(renamed.body.result.data.name).toBe('Cinema picks');

    const events = await call<TrpcEnvelope<{ venueId: string }[]>>(
      `/trpc/folders.getEvents?input=${trpcInput({ folderId: id })}`,
    );
    expect(events.body.result.data.length).toBeGreaterThan(0);
    expect(events.body.result.data.every((e) => e.venueId === 'kino-muranow')).toBe(true);

    const deleted = await call<TrpcEnvelope<{ ok: boolean }>>('/trpc/folders.delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    expect(deleted.body.result.data.ok).toBe(true);
  });

  it('folders.create rejects an empty name', async () => {
    const res = await app.request('http://localhost/trpc/folders.create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', venueIds: [], filters: {} }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
