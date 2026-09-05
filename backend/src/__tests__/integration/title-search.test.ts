import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { defaultEventStore } from '../../services/event-store.js';

/**
 * GOI-112: searching a title across every venue.
 *
 * DB-backed because the whole of it is one SQL predicate — an escaped,
 * case-insensitive ILIKE — and a fake store would only assert that the fake
 * does what the fake does. Skipped with no DATABASE_URL; CI has one.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const VENUE_URL = 'https://goi112-kino.test/repertuar';

describeIfDb('searching a title across venues (GOI-112)', () => {
  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const [venue] = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('GOI112 Kino', ${VENUE_URL}, 'Warsaw', 'PL', 'cinema', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      const venueId = (venue as { id: string }).id;
      const soon = new Date(Date.now() + 2 * 86_400_000);
      await sql`
        INSERT INTO events (venue_id, title, starts_at, category, source_url, kind)
        VALUES
          (${venueId}, 'Chungking Express', ${soon}, 'cinema', 'https://goi112-kino.test/e/1', 'timed'),
          (${venueId}, 'Upadłe anioły', ${soon}, 'cinema', 'https://goi112-kino.test/e/2', 'timed'),
          (${venueId}, '100% wełny', ${soon}, 'cinema', 'https://goi112-kino.test/e/3', 'timed')
        ON CONFLICT DO NOTHING`;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`DELETE FROM venues WHERE url = ${VENUE_URL}`;
    } finally {
      await sql.end();
    }
  });

  const search = (q: string) => defaultEventStore.listUpcoming({ titleQuery: q, limit: 50 });

  it('matches part of a title, in any case', async () => {
    expect((await search('chungking')).map((e) => e.title)).toContain('Chungking Express');
    expect((await search('EXPRESS')).map((e) => e.title)).toContain('Chungking Express');
  });

  it('matches through Polish diacritics as typed', async () => {
    expect((await search('anioły')).map((e) => e.title)).toContain('Upadłe anioły');
  });

  it('finds nothing for a title no venue has announced', async () => {
    // The answer the feature is really for — it is what puts a title on the
    // reader's list rather than ending the search.
    expect(await search('Nieistniejący film 2099')).toEqual([]);
  });

  /**
   * `%` and `_` are characters in what somebody typed, not wildcards. Without
   * the escape, searching "100%" matches every event in the database — the
   * search would answer "yes, everything" to a question about one film.
   */
  it('treats a wildcard in the query as a character', async () => {
    const wild = await search('100%');
    expect(wild.map((e) => e.title)).toContain('100% wełny');
    expect(wild.every((e) => e.title.includes('100%'))).toBe(true);

    expect(await search('100%zzz')).toEqual([]);
    // `_` likewise: it would otherwise match any single character.
    expect(await search('1_0%')).toEqual([]);
  });
});
