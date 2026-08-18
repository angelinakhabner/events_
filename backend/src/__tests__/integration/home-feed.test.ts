/**
 * GOI-70: the home feed showed less music than /my did, for the same venues.
 *
 * Both pages ask for "upcoming events" and then keep the ones matching the
 * selected category. The difference is *where* the narrowing happens: /my
 * narrows by venue in SQL, before the row limit, while the home feed took the
 * globally-earliest 100 Warsaw events and filtered afterwards. A cinema
 * publishes eight screenings a day and a concert hall one a week, so those 100
 * rows were spent on cinema before the week's concerts appeared in them.
 *
 * This suite builds that density for real — it is the only way to show the bug,
 * since it only appears once one category outnumbers the limit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createApp } from '../../app.js';
import { defaultEventStore } from '../../services/event-store.js';
import { filterEvents } from '../../services/filters.js';
import type { Event } from '@afisz/shared';

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

const app = createApp();
const DAY = 86_400_000;

const CINEMA_URL = 'https://goi70-kino.test/repertuar';
const MUSIC_URL = 'https://goi70-jazz.test/koncerty';

/**
 * Screenings per day at the cinema, and days of them. Sized past *both* row
 * limits in play — the home feed's 100 and /my's 500 — because each bug only
 * appears once one category outnumbers the limit.
 */
const SCREENINGS_PER_DAY = 8;
const CINEMA_DAYS = 70;
/** Days from now that the jazz club's concerts fall on — sparse and spread,
 *  so every one of them sits behind a wall of cinema rows. */
const CONCERT_DAYS = [3, 9, 16, 24, 31];
/**
 * When the theatre comes back from summer break (GOI-71). Far enough out that
 * 500 rows of cinema are exhausted before reaching it — which is why THEATRE
 * on /my rendered "nothing matches" while My Venues reported 20 upcoming.
 */
const THEATRE_DAYS = [62, 64, 66];
const THEATRE_URL = 'https://goi70-teatr.test/repertuar';

interface TrpcEnvelope<T> { result: { data: T } }

async function listDefault(filters?: unknown, fromDay?: string): Promise<Event[]> {
  const params = { ...(filters ? { filters } : {}), ...(fromDay ? { fromDay } : {}) };
  const input = Object.keys(params).length > 0
    ? `?input=${encodeURIComponent(JSON.stringify(params))}`
    : '';
  const res = await app.request(`http://localhost/trpc/events.listDefault${input}`, {
    headers: { 'x-device-id': 'goi70-device' },
  });
  const body = (await res.json()) as TrpcEnvelope<Event[]>;
  return body.result.data;
}

describeIfDb('home feed vs /my — category narrowing (GOI-70)', () => {
  let cinemaId = '';
  let musicId = '';
  let theatreId = '';

  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
      const [cinema] = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('GOI70 Kino', ${CINEMA_URL}, 'Warsaw', 'PL', 'cinema', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      const [music] = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('GOI70 Jazz', ${MUSIC_URL}, 'Warsaw', 'PL', 'music', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      const [theatre] = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('GOI71 Teatr', ${THEATRE_URL}, 'Warsaw', 'PL', 'theatre', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      cinemaId = (cinema as { id: string }).id;
      musicId = (music as { id: string }).id;
      theatreId = (theatre as { id: string }).id;

      const now = Date.now();
      // One multi-row insert: 560 sequential round-trips is the difference
      // between a fast suite and a slow one.
      const rows: { venue_id: string; title: string; starts_at: Date; category: string; source_url: string; kind: string }[] = [];
      for (let d = 0; d < CINEMA_DAYS; d++) {
        for (let s = 0; s < SCREENINGS_PER_DAY; s++) {
          rows.push({
            venue_id: cinemaId,
            title: `Film ${d}-${s}`,
            starts_at: new Date(now + d * DAY + (10 + s) * 3_600_000),
            category: 'cinema',
            source_url: `https://goi70-kino.test/f/${d}-${s}`,
            kind: 'timed',
          });
        }
      }
      for (const d of CONCERT_DAYS) {
        rows.push({
          venue_id: musicId,
          title: `Concert +${d}d`,
          starts_at: new Date(now + d * DAY + 20 * 3_600_000),
          category: 'music',
          source_url: `https://goi70-jazz.test/c/${d}`,
          kind: 'timed',
        });
      }
      for (const d of THEATRE_DAYS) {
        rows.push({
          venue_id: theatreId,
          title: `Spektakl +${d}d`,
          starts_at: new Date(now + d * DAY + 19 * 3_600_000),
          category: 'theatre',
          source_url: `https://goi70-teatr.test/s/${d}`,
          kind: 'timed',
        });
      }
      await sql`INSERT INTO events ${sql(rows, 'venue_id', 'title', 'starts_at', 'category', 'source_url', 'kind')}`;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
      await sql`DELETE FROM venues WHERE url IN (${CINEMA_URL}, ${MUSIC_URL}, ${THEATRE_URL})`;
    } finally {
      await sql.end();
    }
  });

  it('reproduces the bug: filtering after the limit truncates the concerts', async () => {
    // Exactly what listDefault used to do.
    const rows = await defaultEventStore.listUpcoming({ city: 'Warsaw', limit: 100 });
    const music = filterEvents(rows, new Map(), { categories: ['music'] });

    expect(rows).toHaveLength(100);
    // 100 rows buys about twelve days of this cinema's repertoire, so only the
    // concerts inside that span survive. The rest are real, upcoming, and
    // unreachable — which is the reported symptom: /my lists five, the home
    // page lists two.
    expect(music.map((e) => e.title)).toEqual(['Concert +3d', 'Concert +9d']);
    expect(music.length).toBeLessThan(CONCERT_DAYS.length);
  });

  it('narrowing by category in SQL returns the concerts', async () => {
    const rows = await defaultEventStore.listUpcoming({
      city: 'Warsaw',
      categories: ['music'],
      limit: 100,
    });
    expect(rows.map((e) => e.title).sort()).toEqual(
      CONCERT_DAYS.map((d) => `Concert +${d}d`).sort(),
    );
  });

  it('the home feed now shows the same music /my does, for the same venues', async () => {
    const home = await listDefault({ categories: ['music'] });
    // The /my query shape: narrowed by venue in SQL, then filtered.
    const scoped = await defaultEventStore.listUpcoming({
      venueIds: [cinemaId, musicId],
      limit: 500,
    });
    const mine = filterEvents(scoped, new Map(), { categories: ['music'] });

    expect(home.map((e) => e.title).sort()).toEqual(mine.map((e) => e.title).sort());
    expect(home).toHaveLength(CONCERT_DAYS.length);
  });

  /**
   * GOI-85: the unfiltered feed used to stop at exactly the row limit, which
   * is where the sparse categories were being lost. It now carries the limit
   * *plus* the top-ups for whatever was short — so it is no longer 100, and
   * asserting 100 here would be asserting the bug.
   */
  it('carries the limit plus the per-category top-ups', async () => {
    const all = await listDefault();
    expect(all.length).toBeGreaterThan(100);
    // Still one chronological listing, which the frontend's bucketing needs.
    const starts = all.map((e) => e.startsAt);
    expect([...starts].sort()).toEqual(starts);
    // And no row arrives twice, though the top-up re-selects rows the base
    // query already returned.
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  /**
   * GOI-71 asked whether the empty THEATRE list on /my was (a) a correct query
   * over too narrow a window, or (b) a broken query. It is (b), and the same
   * bug as above: /my narrows by venue in SQL but applies the *category* after
   * its 500-row limit, so a theatre returning from summer break sits behind
   * two months of cinema and never arrives.
   *
   * The contradiction the ticket points at falls straight out of this: the
   * events list says nothing is on while My Venues says 3 upcoming, because My
   * Venues reads `venueActivity`, an aggregate with no row limit at all.
   */
  it('reproduces GOI-71: /my drops the theatre programme the venue list still counts', async () => {
    const scoped = await defaultEventStore.listUpcoming({
      venueIds: [cinemaId, musicId, theatreId],
      limit: 500,
    });
    const theatre = filterEvents(scoped, new Map(), { categories: ['theatre'] });

    expect(scoped).toHaveLength(500);
    expect(theatre).toHaveLength(0);

    // Same data, same venue, no limit: the app plainly knows these exist.
    const [activity] = await defaultEventStore.venueActivity([theatreId]);
    expect(activity!.upcomingCount).toBe(THEATRE_DAYS.length);
    expect(activity!.nextStartsAt).not.toBeNull();
  });

  it('narrowing by category gives /my the theatre programme back', async () => {
    const rows = await defaultEventStore.listUpcoming({
      venueIds: [cinemaId, musicId, theatreId],
      categories: ['theatre'],
      limit: 500,
    });
    expect(rows.map((e) => e.title).sort()).toEqual(
      THEATRE_DAYS.map((d) => `Spektakl +${d}d`).sort(),
    );
  });

  it('treats an explicitly empty category list as "nothing", not "everything"', async () => {
    const rows = await defaultEventStore.listUpcoming({ city: 'Warsaw', categories: [], limit: 100 });
    expect(rows).toHaveLength(0);
  });

  /**
   * GOI-85: "if no events in the nearest days available — show upcoming",
   * within a 90-day window, at least five per category.
   *
   * GOI-70 above fixed the *filtered* view by narrowing in SQL. This is the
   * case that narrowing cannot reach: the unfiltered feed wants every category
   * at once, so the limit is still spent on cinema and a theatre returning
   * from summer break — 62 days out, in this fixture — never arrives.
   */
  describe('a floor under every category (GOI-85)', () => {
    it('reaches past the limit for a theatre that is dark for two months', async () => {
      const all = await listDefault();
      const theatre = all.filter((e) => e.category === 'theatre');
      expect(theatre.map((e) => e.title).sort()).toEqual(
        THEATRE_DAYS.map((d) => `Spektakl +${d}d`).sort(),
      );
    });

    // The old behaviour, kept as the contrast: without the floor these rows
    // are real, upcoming, and unreachable.
    it('is the difference — the plain query still cannot see them', async () => {
      const rows = await defaultEventStore.listUpcoming({ city: 'Warsaw', limit: 100 });
      expect(rows.filter((e) => e.category === 'theatre')).toHaveLength(0);
    });

    it('completes a category the limit only half-reached', async () => {
      const all = await listDefault();
      const music = all.filter((e) => e.category === 'music');
      // Two concerts fit inside the limit; the floor fetches the rest.
      expect(music.map((e) => e.title).sort()).toEqual(
        CONCERT_DAYS.map((d) => `Concert +${d}d`).sort(),
      );
      expect(music.length).toBe(CONCERT_DAYS.length);
    });

    // A category with plenty on this week must not be reached further out for
    // — that would trail next season behind a listing headed "what's on".
    it('leaves a busy category at the limit rather than reaching further', async () => {
      const all = await listDefault();
      const cinema = all.filter((e) => e.category === 'cinema');
      const furthest = Math.max(...cinema.map((e) => Date.parse(e.startsAt)));
      expect(furthest - Date.now()).toBeLessThan(30 * DAY);
    });

    it('still honours an explicit category filter', async () => {
      const theatre = await listDefault({ categories: ['theatre'] });
      expect(theatre.every((e) => e.category === 'theatre')).toBe(true);
      expect(theatre).toHaveLength(THEATRE_DAYS.length);
    });
  });

  /**
   * GOI-88: the same limit, one dimension over. The day strip narrowed the
   * feed's nearest 100 rows in the browser, and this cinema's programme fills
   * those in about twelve days — so every chip past the twelfth answered
   * "nothing on", for days that are visibly full.
   */
  describe('the day strip (GOI-88)', () => {
    /** The Warsaw day a fixture actually landed on. Derived rather than
     *  computed from its offset: these rows are seeded at `now + n days + 19h`,
     *  so which Warsaw day that is depends on the hour the suite runs at. */
    async function dayOf(title: string, category: 'music' | 'theatre'): Promise<string> {
      const rows = await defaultEventStore.listUpcoming({
        city: 'Warsaw', categories: [category], limit: 100,
      });
      const row = rows.find((e) => e.title === title);
      expect(row, `fixture ${title} should exist`).toBeDefined();
      return warsawDay(row!.startsAt);
    }

    it('reproduces the bug: the nearest 100 rows stop long before the chip does', async () => {
      const rows = await defaultEventStore.listUpcoming({ city: 'Warsaw', limit: 100 });
      const days = new Set(rows.map((e) => warsawDay(e.startsAt)));

      expect(rows).toHaveLength(100);
      // A month out there is a concert on a day this listing never reaches:
      // filtering these rows for it can only ever answer "nothing on".
      expect(days.has(await dayOf('Concert +31d', 'music'))).toBe(false);
    });

    it('starting the listing at the chosen day reaches it', async () => {
      const day = await dayOf('Concert +31d', 'music');
      const rows = await listDefault(undefined, day);

      expect(rows.map((e) => e.title)).toContain('Concert +31d');
      // …and nothing before it: the strip asked for that day onward. The
      // per-category top-ups (GOI-85) inherit the same start, so they cannot
      // reach back behind the reader either.
      expect(rows.every((e) => warsawDay(e.startsAt) >= day)).toBe(true);
      expect(warsawDay(rows[0]!.startsAt)).toBe(day);
    });

    it('carries on past the chosen day, so an empty one can name the next', async () => {
      // The theatre plays three days two months out; the day after the first
      // of them has nothing on it.
      const quiet = nextDay(await dayOf('Spektakl +62d', 'theatre'));
      const rows = await listDefault({ categories: ['theatre'] }, quiet);

      expect(rows.map((e) => warsawDay(e.startsAt))).not.toContain(quiet);
      // What is left is exactly what the "next event on…" notice reads.
      expect(rows[0]!.title).toBe('Spektakl +64d');
    });
  });
});

/** The Warsaw day after a day key. */
function nextDay(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T12:00:00.000Z`) + DAY).toISOString().slice(0, 10);
}

/** Warsaw calendar day of an ISO instant — the unit the strip works in. */
function warsawDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}
