import { describe, it, expect } from 'vitest';
import { createApp } from '../../app.js';
import { defaultAuthStore, requestMagicLink } from '../../services/auth.js';
import { DEFAULT_VENUES } from '../../data/default-venues.js';

/** Unique per run: reruns against a persistent DB must exercise the fresh
 *  first-login path (ensureSeeded), not a leftover account from a prior run. */
const RUN = Math.random().toString(16).slice(2);

// Full login → /my flow through the real Hono app and tRPC router. Locally
// (no DATABASE_URL) the in-memory stores back it; in CI the same tests run
// against the real Postgres service, so ids must be genuine (want_to_go has
// uuid + FK constraints there). The magic-link token is taken from the auth
// service directly — the API never exposes it.

const HAS_DB = !!process.env.DATABASE_URL;

/** An event id that satisfies the DB's uuid/FK constraints: with a DB we
 *  insert a real venue + event row; in-memory any string id works. */
async function usableEventId(): Promise<string> {
  if (!HAS_DB) return 'evt-1';
  const { getDb, schema } = await import('../../db/index.js');
  const db = getDb();
  const [venue] = await db
    .insert(schema.venues)
    .values({
      name: 'WTG fixture venue',
      url: `https://wtg-fixture.example/${Math.random().toString(16).slice(2)}`,
      city: 'Warsaw',
      country: 'PL',
      category: 'music',
    })
    .returning();
  const [event] = await db
    .insert(schema.events)
    .values({
      venueId: venue!.id,
      title: 'WTG fixture event',
      startsAt: new Date(Date.now() + 86_400_000),
      category: 'music',
      sourceUrl: 'https://wtg-fixture.example/event',
    })
    .returning();
  return event!.id;
}

const app = createApp();

async function trpcCall(path: string, opts: { body?: unknown; token?: string; query?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const url = `/trpc/${path}${opts.query ? `?input=${encodeURIComponent(opts.query)}` : ''}`;
  const res = await app.request(url, {
    method: opts.body === undefined ? 'GET' : 'POST',
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const json = (await res.json()) as { result?: { data: unknown }; error?: { message: string } };
  return { status: res.status, data: json.result?.data, error: json.error?.message };
}

async function login(email: string): Promise<string> {
  const { token } = await requestMagicLink(defaultAuthStore, email);
  const verified = await trpcCall('auth.verify', { body: { token } });
  expect(verified.status).toBe(200);
  return (verified.data as { sessionToken: string }).sessionToken;
}

describe('auth + /my flow (in-process)', () => {
  it('my.venues.list is unauthorized without a session', async () => {
    const res = await trpcCall('my.venues.list');
    expect(res.status).toBe(401);
  });

  it('login seeds default venues; edits and custom venues are per-user; venue rows are shared', async () => {
    const alice = await login(`alice-${RUN}@example.com`);
    const bob = await login(`bob-${RUN}@example.com`);

    // Seeded on first login. Exact counts are racy against the shared CI DB
    // (parallel test files add/remove venues), so assert the seeding signal:
    // a healthy number of venues including a known default (Kinoteka).
    const aliceVenues = await trpcCall('my.venues.list', { token: alice });
    expect(aliceVenues.status).toBe(200);
    const seeded = aliceVenues.data as Array<{ url: string }>;
    expect(seeded.length).toBeGreaterThan(0);
    const kinotekaUrl = DEFAULT_VENUES.find((v) => v.id === 'kinoteka')!.url;
    expect(seeded.some((v) => v.url === kinotekaUrl)).toBe(true);

    // Both add the same custom venue by URL — they must share one venue id.
    const add = { name: 'Klub X', url: `https://klubx.example/program-${RUN}`, category: 'music' as const };
    const a = await trpcCall('my.venues.add', { body: add, token: alice });
    const b = await trpcCall('my.venues.add', { body: { ...add, name: 'X u Boba' }, token: bob });
    const aVenue = a.data as { id: string; name: string };
    const bVenue = b.data as { id: string; name: string };
    expect(bVenue.id).toBe(aVenue.id); // scrape-once: one shared row
    expect(aVenue.name).toBe('Klub X');
    expect(bVenue.name).toBe('X u Boba'); // personal override

    // Alice edits category + window — visible to her only.
    const upd = await trpcCall('my.venues.update', {
      body: { venueId: aVenue.id, category: 'comedy', windowDays: 45 },
      token: alice,
    });
    expect((upd.data as { category: string }).category).toBe('comedy');
    const bobView = (await trpcCall('my.venues.list', { token: bob })).data as Array<{ id: string; category: string }>;
    expect(bobView.find((v) => v.id === aVenue.id)!.category).toBe('music');

    // Alice unsubscribes; Bob keeps the venue.
    const rm = await trpcCall('my.venues.remove', { body: { venueId: aVenue.id }, token: alice });
    expect((rm.data as { success: boolean }).success).toBe(true);
    const bobAfter = (await trpcCall('my.venues.list', { token: bob })).data as Array<{ id: string }>;
    expect(bobAfter.some((v) => v.id === aVenue.id)).toBe(true);
  });

  it('want-to-go add/ids/remove round-trips and is per-user', async () => {
    const alice = await login(`a2-${RUN}@example.com`);
    const bob = await login(`b2-${RUN}@example.com`);
    const eventId = await usableEventId();

    await trpcCall('my.wantToGo.add', { body: { eventId }, token: alice });
    expect((await trpcCall('my.wantToGo.ids', { token: alice })).data).toEqual([eventId]);
    expect((await trpcCall('my.wantToGo.ids', { token: bob })).data).toEqual([]);

    const rm = await trpcCall('my.wantToGo.remove', { body: { eventId }, token: alice });
    expect((rm.data as { success: boolean }).success).toBe(true);
    expect((await trpcCall('my.wantToGo.ids', { token: alice })).data).toEqual([]);
  });

  it('logout kills the session', async () => {
    const t = await login(`c-${RUN}@example.com`);
    await trpcCall('auth.logout', { body: {}, token: t });
    const res = await trpcCall('my.venues.list', { token: t });
    expect(res.status).toBe(401);
  });
});
