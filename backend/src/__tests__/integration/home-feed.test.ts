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

/** Screenings per day at the cinema, and days of them: comfortably past the
 *  100-row limit, which is what makes the bug reproducible at all. */
const SCREENINGS_PER_DAY = 8;
const CINEMA_DAYS = 14;
/** Days from now that the jazz club's concerts fall on — sparse and spread,
 *  so every one of them sits behind a wall of cinema rows. */
const CONCERT_DAYS = [3, 9, 16, 24, 31];

interface TrpcEnvelope<T> { result: { data: T } }

async function listDefault(filters?: unknown): Promise<Event[]> {
  const input = filters ? `?input=${encodeURIComponent(JSON.stringify({ filters }))}` : '';
  const res = await app.request(`http://localhost/trpc/events.listDefault${input}`, {
    headers: { 'x-device-id': 'goi70-device' },
  });
  const body = (await res.json()) as TrpcEnvelope<Event[]>;
  return body.result.data;
}

describeIfDb('home feed vs /my — category narrowing (GOI-70)', () => {
  let cinemaId = '';
  let musicId = '';

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
      cinemaId = (cinema as { id: string }).id;
      musicId = (music as { id: string }).id;

      const now = Date.now();
      for (let d = 0; d < CINEMA_DAYS; d++) {
        for (let s = 0; s < SCREENINGS_PER_DAY; s++) {
          const startsAt = new Date(now + d * DAY + (10 + s) * 3_600_000);
          await sql`
            INSERT INTO events (venue_id, title, starts_at, category, source_url, kind)
            VALUES (${cinemaId}, ${`Film ${d}-${s}`}, ${startsAt}, 'cinema',
                    ${`https://goi70-kino.test/f/${d}-${s}`}, 'timed')`;
        }
      }
      for (const d of CONCERT_DAYS) {
        const startsAt = new Date(now + d * DAY + 20 * 3_600_000);
        await sql`
          INSERT INTO events (venue_id, title, starts_at, category, source_url, kind)
          VALUES (${musicId}, ${`Concert +${d}d`}, ${startsAt}, 'music',
                  ${`https://goi70-jazz.test/c/${d}`}, 'timed')`;
      }
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
      await sql`DELETE FROM venues WHERE url IN (${CINEMA_URL}, ${MUSIC_URL})`;
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

  it('leaves the unfiltered feed alone', async () => {
    const all = await listDefault();
    expect(all).toHaveLength(100);
  });

  it('treats an explicitly empty category list as "nothing", not "everything"', async () => {
    const rows = await defaultEventStore.listUpcoming({ city: 'Warsaw', categories: [], limit: 100 });
    expect(rows).toHaveLength(0);
  });
});
