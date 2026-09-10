import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { defaultEventStore } from '../../services/event-store.js';

/**
 * GOI-112: searching a title across every venue, and watching one that isn't on.
 *
 * DB-backed because the whole of both is a SQL predicate — an escaped ILIKE
 * for the search, an escaped word-boundary regex for the watch — and a fake
 * store would only assert that the fake does what the fake does. The watch is
 * the half that most needs a real engine: it is asserting that *Postgres*
 * agrees with us about where a word ends, which is not a thing JavaScript can
 * be asked. Skipped with no DATABASE_URL; CI has one.
 */
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const VENUE_URL = 'https://goi112-kino.test/repertuar';

/** The titles seeded below, spelt as a venue announced them. */
const SEEDED = ['Chungking Express', 'Upadłe anioły', '100% wełny', 'Spirited Away', 'Dogville (2003)'];

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
          (${venueId}, '100% wełny', ${soon}, 'cinema', 'https://goi112-kino.test/e/3', 'timed'),
          (${venueId}, 'Spirited Away', ${soon}, 'cinema', 'https://goi112-kino.test/e/4', 'timed'),
          (${venueId}, 'Dogville (2003)', ${soon}, 'cinema', 'https://goi112-kino.test/e/5', 'timed')
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

  /**
   * The other half of GOI-112: what a *tracked* title does once it is on the
   * list and nobody is watching the screen.
   *
   * Before the cross-venue search, a title reached the want-to-go list only from
   * a real screening, so it was spelt exactly as its venue spelt it and an exact
   * re-check was right. A title now arrives from a search box *that found
   * nothing*, so it is whatever somebody typed — and that is precisely the title
   * an exact re-check can never match, which would have left the one route that
   * exists to say "tell me when this is announced" unable to say it.
   */
  describe('watching a tracked title', () => {
    const watch = (title: string) => defaultEventStore.listUpcoming({ titleWords: title, limit: 50 });

    it('finds the film behind the words somebody typed', async () => {
      // What the search box was given when it answered "nothing on".
      expect((await watch('chungking')).map((e) => e.title)).toContain('Chungking Express');
      expect((await watch('Chungking Express')).map((e) => e.title)).toContain('Chungking Express');
    });

    /**
     * The reason it is words rather than a substring. A watch runs unattended
     * for months, with nobody to look at what came back and retype it — so a
     * tracked "It" hiding inside "Spirited" would report a reader's list back to
     * them as news, once a fortnight, for as long as they kept it.
     */
    it('will not match a title hidden inside a longer word', async () => {
      const found = (await watch('It')).map((e) => e.title);
      expect(found).not.toContain('Spirited Away');
    });

    it('matches through Polish diacritics as typed', async () => {
      expect((await watch('anioły')).map((e) => e.title)).toContain('Upadłe anioły');
    });

    /**
     * A tracked title is a string somebody typed, so every metacharacter in it
     * is a character. Unescaped, `(2003)` is a *group*: it would match
     * "Dogville 2003" and not the title it was copied from. And an unbalanced
     * bracket is a syntax error Postgres raises rather than a query that finds
     * nothing — a quiet "not announced yet" would become a failed sweep, for
     * every reader on it, because of one title on one list.
     */
    it('treats regex punctuation in the title as punctuation', async () => {
      expect((await watch('Dogville (2003)')).map((e) => e.title)).toEqual(['Dogville (2003)']);
      expect(await watch('Dogville 2003')).toEqual([]);
      expect((await watch('Dogville (')).map((e) => e.title)).toEqual(['Dogville (2003)']);
    });

    /**
     * The round trip the whole thing rests on: every title in the database is
     * found by watching for itself. A boundary asserted at an end Postgres does
     * not read as a word — the `%` of "100% wełny", the `½` of "8½" — matches
     * nothing at all, and the failure is silent: the watch says "not announced
     * yet" about a film that is on tonight, for ever.
     */
    it('finds every announced title by watching for that exact title', async () => {
      for (const title of SEEDED) {
        expect((await watch(title)).map((e) => e.title)).toContain(title);
      }
    });

    it('still finds nothing for a title no venue has announced', async () => {
      expect(await watch('Nieistniejący film 2099')).toEqual([]);
    });
  });
});
