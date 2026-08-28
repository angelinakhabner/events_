import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
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

  // GOI-26: marking an entry seen keeps it on the list rather than dropping it.
  it.skipIf(!HAS_DB)('want-to-go entries carry a seen mark that toggles', async () => {
    const erin = await login(`erin-${RUN}@example.com`);
    const eventId = await usableEventId();
    await trpcCall('my.wantToGo.add', { body: { eventId }, token: erin });

    type Entry = { event: { id: string }; seenAt: string | null };
    const fresh = (await trpcCall('my.wantToGo.entries', { token: erin })).data as Entry[];
    expect(fresh.map((e) => e.event.id)).toEqual([eventId]);
    expect(fresh[0]!.seenAt).toBeNull();

    const marked = await trpcCall('my.wantToGo.setSeen', { body: { eventId, seen: true }, token: erin });
    expect((marked.data as { success: boolean }).success).toBe(true);
    const seen = (await trpcCall('my.wantToGo.entries', { token: erin })).data as Entry[];
    expect(seen).toHaveLength(1); // still on the list
    expect(seen[0]!.seenAt).not.toBeNull();

    await trpcCall('my.wantToGo.setSeen', { body: { eventId, seen: false }, token: erin });
    const unmarked = (await trpcCall('my.wantToGo.entries', { token: erin })).data as Entry[];
    expect(unmarked[0]!.seenAt).toBeNull();
  });

  // GOI-47: a read-only public link to a want-to-go list.
  describe('sharing', () => {
    type Share = { token: string | null };
    type Shared = { entries: Array<{ event: { id: string } }>; films: Array<{ id: string }> };

    const sharedList = (token: string) =>
      trpcCall('sharedList.get', { query: JSON.stringify({ token }) });

    it('is off until asked for, and the same link comes back on re-share', async () => {
      const gina = await login(`gina-${RUN}@example.com`);
      expect(((await trpcCall('my.wantToGo.share.get', { token: gina })).data as Share).token).toBeNull();

      const first = (await trpcCall('my.wantToGo.share.enable', { body: {}, token: gina }))
        .data as Share;
      expect(first.token).toBeTruthy();

      // Pressing "share" twice must not break a URL a friend already has.
      const again = (await trpcCall('my.wantToGo.share.enable', { body: {}, token: gina }))
        .data as Share;
      expect(again.token).toBe(first.token);
      expect(((await trpcCall('my.wantToGo.share.get', { token: gina })).data as Share).token)
        .toBe(first.token);
    });

    it.skipIf(!HAS_DB)('serves the owner\'s unseen list to anyone holding the link', async () => {
      const hana = await login(`hana-${RUN}@example.com`);
      const wanted = await usableEventId();
      const been = await usableEventId();
      await trpcCall('my.wantToGo.add', { body: { eventId: wanted }, token: hana });
      await trpcCall('my.wantToGo.add', { body: { eventId: been }, token: hana });
      await trpcCall('my.wantToGo.setSeen', { body: { eventId: been, seen: true }, token: hana });
      await trpcCall('my.films.add', { body: { title: `Vertigo ${RUN}` }, token: hana });

      const { token } = (await trpcCall('my.wantToGo.share.enable', { body: {}, token: hana }))
        .data as Share;

      // No Authorization header: this is the whole point of the feature.
      const shared = (await sharedList(token!)).data as Shared;
      expect(shared.entries.map((e) => e.event.id)).toEqual([wanted]);
      expect(shared.films).toHaveLength(1);
    });

    it('revoking kills the link, and re-sharing mints a different one', async () => {
      const ivan = await login(`ivan-${RUN}@example.com`);
      const { token } = (await trpcCall('my.wantToGo.share.enable', { body: {}, token: ivan }))
        .data as Share;
      expect((await sharedList(token!)).error).toBeUndefined();

      await trpcCall('my.wantToGo.share.disable', { body: {}, token: ivan });
      expect((await sharedList(token!)).error).toMatch(/not shared/i);

      const reshared = (await trpcCall('my.wantToGo.share.enable', { body: {}, token: ivan }))
        .data as Share;
      expect(reshared.token).not.toBe(token);
      // The link that was handed out and revoked stays dead.
      expect((await sharedList(token!)).error).toMatch(/not shared/i);
    });

    it('rejects a made-up token the same way as a revoked one', async () => {
      expect((await sharedList('not-a-real-token')).error).toMatch(/not shared/i);
    });

    it('needs a session to manage sharing', async () => {
      expect((await trpcCall('my.wantToGo.share.get')).error).toBeTruthy();
      expect((await trpcCall('my.wantToGo.share.enable', { body: {} })).error).toBeTruthy();
    });
  });

  // GOI-25: the "My venues" tab needs every venue at once, each tagged and
  // labelled with the folder it sits in.
  it('venues.listAll spans folders and carries per-user tags', async () => {
    const frank = await login(`frank-${RUN}@example.com`);
    const warsaw = ((await trpcCall('my.lists.list', { token: frank })).data as Array<{ id: string }>)[0]!;
    const other = (await trpcCall('my.lists.create', { body: { name: 'Kraków' }, token: frank }))
      .data as { id: string };

    const parked = (await trpcCall('my.venues.add', {
      body: {
        name: 'Kino Pod Baranami',
        url: `https://baranami.example/${RUN}`,
        category: 'cinema',
        listId: other.id,
      },
      token: frank,
    })).data as { id: string };

    // Scoped list only sees the active folder; listAll sees both.
    const scoped = (await trpcCall('my.venues.list', { token: frank })).data as Array<{ id: string }>;
    expect(scoped.some((v) => v.id === parked.id)).toBe(false);
    const all = (await trpcCall('my.venues.listAll', { token: frank })).data as Array<{
      id: string; listId: string | null; tags: string[];
    }>;
    expect(all.find((v) => v.id === parked.id)!.listId).toBe(other.id);
    expect(all.every((v) => Array.isArray(v.tags))).toBe(true);

    // Tagging, then moving the venue back into the seeded folder.
    const tagged = (await trpcCall('my.venues.update', {
      body: { venueId: parked.id, tags: ['weekend', 'weekend', ' arthouse '] },
      token: frank,
    })).data as { tags: string[] };
    expect(tagged.tags).toEqual(['weekend', 'arthouse']); // trimmed + de-duped

    const moved = (await trpcCall('my.venues.update', {
      body: { venueId: parked.id, listId: warsaw.id },
      token: frank,
    })).data as { listId: string; tags: string[] };
    expect(moved.listId).toBe(warsaw.id);
    expect(moved.tags).toEqual(['weekend', 'arthouse']); // the move keeps them
  });

  // GOI-27: the Events tab is scoped to the user's own venues.
  it.skipIf(!HAS_DB)('my.events.list only returns events at venues the user follows', async () => {
    const gina = await login(`gina-${RUN}@example.com`);
    // usableEventId inserts a venue + event nobody is subscribed to.
    const strangerEvent = await usableEventId();

    const before = (await trpcCall('my.events.list', { token: gina })).data as Array<{ id: string }>;
    expect(before.some((e) => e.id === strangerEvent)).toBe(false);

    const { getDb, schema } = await import('../../db/index.js');
    const [row] = await getDb()
      .select({ venueId: schema.events.venueId })
      .from(schema.events)
      .where(eq(schema.events.id, strangerEvent));
    const venue = await getDb()
      .select({ url: schema.venues.url })
      .from(schema.venues)
      .where(eq(schema.venues.id, row!.venueId));

    // Subscribing to that venue by URL re-uses the same row, so its event
    // shows up on Gina's Events tab.
    await trpcCall('my.venues.add', {
      body: { name: 'Followed venue', url: venue[0]!.url, category: 'music' },
      token: gina,
    });
    const after = (await trpcCall('my.events.list', { token: gina })).data as Array<{ id: string }>;
    expect(after.some((e) => e.id === strangerEvent)).toBe(true);
  });

  // GOI-28: "Generate" renders the brief without saving or sending.
  it('newsletter preview renders a brief from unsaved settings', async () => {
    const hana = await login(`hana-${RUN}@example.com`);
    const res = await trpcCall('my.newsletter.preview', {
      body: {
        email: `hana-${RUN}@example.com`,
        frequency: 'weekly',
        venueIds: [],
        sendHour: 9,
        sendWeekday: 4,
        eventTags: [],
        enabled: true,
      },
      token: hana,
    });
    expect(res.status).toBe(200);
    const { html, events } = res.data as { html: string; events: unknown[] };
    expect(html).toContain('This week in<br>Warsaw');
    expect(html).toContain('AFISZ · WEEKLY');
    expect(Array.isArray(events)).toBe(true);
    // Preview must not create a subscription.
    expect((await trpcCall('my.newsletter.get', { token: hana })).data).toBeNull();
  });

  it('logout kills the session', async () => {
    const t = await login(`c-${RUN}@example.com`);
    await trpcCall('auth.logout', { body: {}, token: t });
    const res = await trpcCall('my.venues.list', { token: t });
    expect(res.status).toBe(401);
  });

  it('lists: seeded Warsaw is active; create/switch scope venues; delete falls back', async () => {
    const carol = await login(`carol-${RUN}@example.com`);

    // First login → one active "Warsaw" list holding the seeded venues.
    const initial = (await trpcCall('my.lists.list', { token: carol })).data as Array<{
      id: string; name: string; active: boolean; venueCount: number;
    }>;
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ name: 'Warsaw', active: true });
    expect(initial[0]!.venueCount).toBeGreaterThan(0);
    const warsaw = initial[0]!;

    // A second list starts empty and inactive; duplicates are rejected.
    const poznan = (await trpcCall('my.lists.create', { body: { name: 'Poznan' }, token: carol }))
      .data as { id: string; active: boolean; venueCount: number };
    expect(poznan.active).toBe(false);
    const dup = await trpcCall('my.lists.create', { body: { name: 'Poznan' }, token: carol });
    expect(dup.status).toBe(409);

    // Switch to Poznan → my.venues.list now shows that (empty) list.
    await trpcCall('my.lists.setActive', { body: { listId: poznan.id }, token: carol });
    expect((await trpcCall('my.venues.list', { token: carol })).data).toEqual([]);

    // Adding a venue while Poznan is active lands it in Poznan only.
    const added = (await trpcCall('my.venues.add', {
      body: { name: 'Kino Pałacowe', url: `https://palacowe.example/program-${RUN}`, category: 'cinema' },
      token: carol,
    })).data as { id: string };
    const inPoznan = (await trpcCall('my.venues.list', { token: carol })).data as Array<{ id: string }>;
    expect(inPoznan.map((v) => v.id)).toEqual([added.id]);
    const inWarsaw = (await trpcCall('my.venues.list', {
      token: carol, query: JSON.stringify({ listId: warsaw.id }),
    })).data as Array<{ id: string }>;
    expect(inWarsaw.some((v) => v.id === added.id)).toBe(false);

    // Renaming works; deleting the active list falls back to the oldest one.
    const renamed = (await trpcCall('my.lists.rename', {
      body: { listId: poznan.id, name: 'Poznań' }, token: carol,
    })).data as { name: string };
    expect(renamed.name).toBe('Poznań');
    const rm = (await trpcCall('my.lists.remove', { body: { listId: poznan.id }, token: carol }))
      .data as { success: boolean };
    expect(rm.success).toBe(true);
    const after = (await trpcCall('my.lists.list', { token: carol })).data as Array<{
      name: string; active: boolean;
    }>;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ name: 'Warsaw', active: true });
  });

  it.skipIf(!HAS_DB)('scrape targeting skips venues that live only in inactive lists', async () => {
    const dave = await login(`dave-${RUN}@example.com`);

    // Venue in a list Dave is NOT viewing → not a scrape target. Venue in his
    // active list → target. (Unique URLs so other CI users can't interfere.)
    const idle = (await trpcCall('my.lists.create', { body: { name: 'Idle city' }, token: dave }))
      .data as { id: string };
    const parked = (await trpcCall('my.venues.add', {
      body: { name: 'Parked venue', url: `https://parked.example/${RUN}`, category: 'music', listId: idle.id },
      token: dave,
    })).data as { id: string };
    const live = (await trpcCall('my.venues.add', {
      body: { name: 'Live venue', url: `https://live.example/${RUN}`, category: 'music' },
      token: dave,
    })).data as { id: string };

    const { scrapeTargetVenues } = await import('../../services/scheduler.js');
    const targets = (await scrapeTargetVenues()).map((v) => v.id);
    expect(targets).toContain(live.id);
    expect(targets).not.toContain(parked.id);

    // Switching to the idle list makes its venue a target again.
    await trpcCall('my.lists.setActive', { body: { listId: idle.id }, token: dave });
    const after = (await scrapeTargetVenues()).map((v) => v.id);
    expect(after).toContain(parked.id);
  });
});

// GOI-33: festivals narrowed to venues the reader follows. The matcher is
// unit-tested; what this covers is the procedure wiring — auth, seeding, and
// that it answers in the user's *own* venue names (including renames).
describe('festivals.mine (GOI-33)', () => {
  it('is unauthorized without a session', async () => {
    expect((await trpcCall('festivals.mine')).status).toBe(401);
  });

  it('returns only festivals at the seeded venues, naming which of them host it', async () => {
    const token = await login(`festivals-${RUN}@example.com`);
    const res = await trpcCall('festivals.mine', { token });
    expect(res.status).toBe(200);

    const mine = res.data as Array<{ id: string; venues: string[]; yourVenues: string[] }>;
    // Every returned festival must name at least one of the reader's venues —
    // that is the whole contract, and it holds whatever the seed list contains.
    for (const f of mine) {
      expect(f.yourVenues.length).toBeGreaterThan(0);
    }

    // The seeded defaults include Kinoteka and Kino Muranów, which host the
    // curated Warsaw festivals — so a fresh account sees a non-empty list as
    // long as any edition is still ahead.
    const all = (await trpcCall('festivals.list')).data as Array<{ venues: string[] }>;
    const anyAtSeededVenue = all.some((f) =>
      f.venues.some((c) => /kinoteka|muran/i.test(c)),
    );
    if (anyAtSeededVenue) expect(mine.length).toBeGreaterThan(0);
    // Never wider than the unscoped list.
    expect(mine.length).toBeLessThanOrEqual(all.length);
  });

  it.skipIf(!HAS_DB)('answers in the user\'s renamed venue, not the shared name', async () => {
    const token = await login(`festivals-rename-${RUN}@example.com`);
    const venues = (await trpcCall('my.venues.list', { token })).data as Array<{ id: string; name: string }>;
    const kinoteka = venues.find((v) => /kinoteka/i.test(v.name));
    if (!kinoteka) return; // seed changed; nothing to assert

    await trpcCall('my.venues.update', {
      body: { venueId: kinoteka.id, name: 'Kinoteka (my local)' },
      token,
    });

    const mine = (await trpcCall('festivals.mine', { token })).data as Array<{ yourVenues: string[] }>;
    const named = mine.flatMap((f) => f.yourVenues);
    // Still matches despite the rename — containment, not equality — and it is
    // the reader's own label that comes back.
    if (named.length) expect(named.some((n) => n.includes('my local'))).toBe(true);
  });
});

// GOI-13. The classification is unit-tested; what needs a real database is the
// grouped aggregate behind it — min(starts_at) + count per venue, with venues
// that have nothing upcoming still coming back rather than being dropped by
// the GROUP BY.
describe('my.venues.activity (GOI-13)', () => {
  it.skipIf(!HAS_DB)('reports running, quiet and dark venues from the calendar', async () => {
    const { getDb, schema } = await import('../../db/index.js');
    const db = getDb();
    const token = await login(`activity-${RUN}@example.com`);

    const makeVenue = async (slug: string) => {
      const [v] = await db
        .insert(schema.venues)
        .values({
          name: `Activity ${slug} ${RUN}`,
          url: `https://activity-${slug}-${RUN}.example/program`,
          city: 'Warsaw',
          country: 'PL',
          category: 'theatre',
        })
        .returning();
      await trpcCall('my.venues.add', {
        body: {
          name: `Activity ${slug}`,
          url: v!.url,
          category: 'theatre' as const,
        },
        token,
      });
      return v!.id;
    };

    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
    const running = await makeVenue('running');
    const quiet = await makeVenue('quiet');
    const dark = await makeVenue('dark');

    await db.insert(schema.events).values([
      // Two soon, so the count is not trivially 1 and min() has to pick.
      { venueId: running, title: 'Tonight', startsAt: inDays(1), category: 'theatre', sourceUrl: 'https://x/1' },
      { venueId: running, title: 'Next week', startsAt: inDays(6), category: 'theatre', sourceUrl: 'https://x/2' },
      // Well past the fortnight threshold — the "dark until 19 Sep" case.
      { venueId: quiet, title: 'New season', startsAt: inDays(60), category: 'theatre', sourceUrl: 'https://x/3' },
      // In the past: must not count, and must not make the venue look running.
      { venueId: dark, title: 'Last season', startsAt: inDays(-5), category: 'theatre', sourceUrl: 'https://x/4' },
    ]);

    const res = await trpcCall('my.venues.activity', { token });
    expect(res.status).toBe(200);
    const byId = new Map(
      (res.data as Array<{ venueId: string; state: string; upcomingCount: number }>).map((a) => [a.venueId, a]),
    );

    expect(byId.get(running)).toMatchObject({ state: 'running', upcomingCount: 2 });
    expect(byId.get(quiet)).toMatchObject({ state: 'quiet', upcomingCount: 1 });
    // Present in the result despite matching no event rows at all.
    expect(byId.get(dark)).toMatchObject({ state: 'dark', upcomingCount: 0, nextStartsAt: null });
  });

  it('is unauthorized without a session', async () => {
    expect((await trpcCall('my.venues.activity')).status).toBe(401);
  });
});

/**
 * GOI-92 — the Elsewhere flow's folder handling, through the real router.
 *
 * In CI this runs against Postgres, where the unique index from 0025 is the
 * thing actually being tested: the store's own normalisation and the index's
 * `lower(btrim(name))` have to agree, and no unit test can prove that.
 */
describe('Elsewhere: the destination city folder (GOI-92)', () => {
  const venue = (n: number) => ({
    name: `Elsewhere venue ${n} ${RUN}`,
    url: `https://elsewhere-${RUN}-${n}.example/programm`,
    city: 'Berlin',
    country: 'DE',
    category: 'theatre' as const,
  });

  it('creates the city folder on the first add and reuses it however it is spelled', async () => {
    const token = await login(`elsewhere-${RUN}@example.com`);
    const city = `Berlin ${RUN}`;

    // Nothing yet — the search itself creates no folder, so an abandoned one
    // leaves nothing behind.
    const before = (await trpcCall('my.lists.list', { token })).data as Array<{ name: string }>;
    expect(before.some((l) => l.name === city)).toBe(false);

    for (const [i, spelling] of [city, city.toLowerCase(), `  ${city.toUpperCase()} `].entries()) {
      const res = await trpcCall('my.venues.add', {
        body: { ...venue(i), listName: spelling },
        token,
      });
      expect(res.status).toBe(200);
    }

    const after = (await trpcCall('my.lists.list', { token })).data as Array<{
      id: string; name: string; venueCount: number;
    }>;
    const matching = after.filter((l) => l.name.trim().toLowerCase() === city.toLowerCase());
    expect(matching).toHaveLength(1);
    // The display form is the first spelling, not the normalised key.
    expect(matching[0]!.name).toBe(city);
    expect(matching[0]!.venueCount).toBe(3);
  });

  it('keeps the probe verdict on a venue added despite a failed check', async () => {
    const token = await login(`elsewhere-probe-${RUN}@example.com`);
    const res = await trpcCall('my.venues.add', {
      body: {
        ...venue(99),
        listName: `Berlin probe ${RUN}`,
        probe: { probeErrorCode: 'BLOCKED', requiresPaidFetch: false },
      },
      token,
    });
    expect(res.status).toBe(200);
    expect((res.data as { probeErrorCode: string | null }).probeErrorCode).toBe('BLOCKED');

    const listed = (await trpcCall('my.venues.listAll', { token })).data as Array<{
      url: string; probeErrorCode: string | null;
    }>;
    expect(listed.find((v) => v.url === venue(99).url)?.probeErrorCode).toBe('BLOCKED');
  });

  it('refuses two folders differing only by case', async () => {
    const token = await login(`elsewhere-case-${RUN}@example.com`);
    const name = `Poznan ${RUN}`;
    expect((await trpcCall('my.lists.create', { body: { name }, token })).status).toBe(200);
    const dup = await trpcCall('my.lists.create', { body: { name: name.toUpperCase() }, token });
    expect(dup.status).not.toBe(200);
    expect(dup.error).toMatch(/already have a list/i);
  });
});
