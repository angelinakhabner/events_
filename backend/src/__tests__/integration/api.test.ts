import { describe, it, expect } from 'vitest';
import { createApp } from '../../app.js';

const app = createApp();
const D1 = 'device-test-1';

interface TrpcEnvelope<T> { result: { data: T } }
interface TrpcErrorEnvelope { error: { data?: { code?: string }; message?: string } }

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  if (!headers.has('x-device-id')) headers.set('x-device-id', D1);
  const res = await app.request(`http://localhost${path}`, { ...init, headers });
  return { status: res.status, body: (await res.json()) as T };
}

function trpcInput(obj: unknown): string {
  return encodeURIComponent(JSON.stringify(obj));
}

function post(deviceId: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
    body: JSON.stringify(body),
  };
}

describe('API integration', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await call<{ ok: boolean }>('/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('venues.list returns the default Warsaw seed', async () => {
    const { body } = await call<TrpcEnvelope<{ city: string }[]>>('/trpc/venues.list');
    expect(body.result.data.length).toBeGreaterThan(0);
    expect(body.result.data.every((v) => v.city === 'Warsaw')).toBe(true);
  });

  it('events.listDefault filters by category', async () => {
    const { body } = await call<TrpcEnvelope<{ venueId: string }[]>>(
      `/trpc/events.listDefault?input=${trpcInput({ filters: { categories: ['cinema'] } })}`,
    );
    expect(body.result.data.every((e) => e.venueId === 'kino-muranow')).toBe(true);
  });

  it('folders.listMine rejects requests without an x-device-id header', async () => {
    const res = await app.request('http://localhost/trpc/folders.listMine');
    const body = (await res.json()) as TrpcErrorEnvelope;
    expect(body.error?.data?.code).toBe('UNAUTHORIZED');
  });

  it('folders are partitioned by deviceId', async () => {
    const a = await call<TrpcEnvelope<{ id: string }>>('/trpc/folders.create', post('device-iso-A', { name: 'A list', venueIds: [], filters: {} }));
    const b = await call<TrpcEnvelope<{ id: string }>>('/trpc/folders.create', post('device-iso-B', { name: 'B list', venueIds: [], filters: {} }));

    const listA = await call<TrpcEnvelope<{ name: string }[]>>('/trpc/folders.listMine', { headers: { 'x-device-id': 'device-iso-A' } });
    const listB = await call<TrpcEnvelope<{ name: string }[]>>('/trpc/folders.listMine', { headers: { 'x-device-id': 'device-iso-B' } });

    expect(listA.body.result.data.map((f) => f.name)).toContain('A list');
    expect(listA.body.result.data.map((f) => f.name)).not.toContain('B list');
    expect(listB.body.result.data.map((f) => f.name)).toContain('B list');
    expect(listB.body.result.data.map((f) => f.name)).not.toContain('A list');

    // Cross-device update should fail with UNAUTHORIZED
    const xUpdate = await call<TrpcErrorEnvelope>('/trpc/folders.update', post('device-iso-B', { id: a.body.result.data.id, name: 'pwned' }));
    expect(xUpdate.body.error?.data?.code).toBe('UNAUTHORIZED');

    // Cross-device delete should fail with UNAUTHORIZED
    const xDelete = await call<TrpcErrorEnvelope>('/trpc/folders.delete', post('device-iso-B', { id: a.body.result.data.id }));
    expect(xDelete.body.error?.data?.code).toBe('UNAUTHORIZED');

    // Owner can still delete their own
    const ownDelete = await call<TrpcEnvelope<{ success: boolean }>>('/trpc/folders.delete', post('device-iso-A', { id: a.body.result.data.id }));
    expect(ownDelete.body.result.data.success).toBe(true);
    await call<TrpcEnvelope<{ success: boolean }>>('/trpc/folders.delete', post('device-iso-B', { id: b.body.result.data.id }));
  });

  it('folders CRUD: create → rename → getEvents → delete', async () => {
    const created = await call<TrpcEnvelope<{ id: string; name: string }>>(
      '/trpc/folders.create',
      post(D1, { name: 'Weeknight cinema', venueIds: ['kino-muranow'], filters: { categories: ['cinema'] } }),
    );
    const id = created.body.result.data.id;

    const renamed = await call<TrpcEnvelope<{ name: string }>>(
      '/trpc/folders.update',
      post(D1, { id, name: 'Cinema picks' }),
    );
    expect(renamed.body.result.data.name).toBe('Cinema picks');

    const events = await call<TrpcEnvelope<{ venueId: string }[]>>(
      `/trpc/folders.getEvents?input=${trpcInput({ folderId: id })}`,
    );
    expect(events.body.result.data.every((e) => e.venueId === 'kino-muranow')).toBe(true);

    const deleted = await call<TrpcEnvelope<{ success: boolean }>>('/trpc/folders.delete', post(D1, { id }));
    expect(deleted.body.result.data.success).toBe(true);
  });

  it('folders.create rejects empty name', async () => {
    const res = await app.request('http://localhost/trpc/folders.create', post(D1, { name: '', venueIds: [], filters: {} }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
