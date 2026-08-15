import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getDb, schema } from '../../db/index.js';
import { scrapeVenue } from '../../services/scraper/runner.js';
import { runMigrations } from '../../db/migrate.js';
import type { ExtractorClient } from '../../services/scraper/extractor.js';

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../../test/fixtures');

let muranowHtml = '';
let expectedJson = '';

// A cinema on a host with no deterministic scraper, so these cases keep
// exercising the LLM path (preprocess → mocked Claude → validate → persist).
// The HTML is opaque to that path — the mocked extractor returns `expectedJson`
// regardless — so Muranów's fixture doubles as a realistically-sized page.
const LLM_VENUE_URL = 'https://kino-example.test/repertuar';

describeIfDb('scraper integration', () => {
  let venueId = '';
  let muranowVenueId = '';

  beforeAll(async () => {
    muranowHtml = await fs.readFile(path.join(fixtureDir, 'muranow.html'), 'utf-8');
    expectedJson = await fs.readFile(path.join(fixtureDir, 'muranow-expected.json'), 'utf-8');

    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
      // INSERT...RETURNING gets us each venue's UUID (rows never carry a slug id).
      const rows = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Kino Example', ${LLM_VENUE_URL}, 'Warsaw', 'PL', 'cinema', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;
      venueId = (rows[0] as { id: string }).id;

      const muranowRows = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Kino Muranów', 'https://kinomuranow.pl/repertuar', 'Warsaw', 'PL', 'cinema', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;
      muranowVenueId = (muranowRows[0] as { id: string }).id;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
      // Synthetic venue — not part of the seed, so don't leave it behind.
      await sql`DELETE FROM venues WHERE url = ${LLM_VENUE_URL}`;
    } finally {
      await sql.end();
    }
  });

  beforeEach(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
    } finally {
      await sql.end();
    }
  });

  const makeExtractor = (returns: string): ExtractorClient => ({
    extract: async () => returns,
  });

  it('end-to-end: fixture → mocked Claude → DB rows', async () => {
    const run = await scrapeVenue(venueId, {
      enrichDelayMs: 0,
      htmlOverride: muranowHtml,
      extractor: makeExtractor(expectedJson),
      now: new Date('2026-06-07T08:00:00.000Z'),
    });

    expect(run.status).toBe('success');
    expect(run.eventsFound).toBe(3);

    const db = getDb();
    const rows = await db.select().from(schema.events);
    expect(rows).toHaveLength(3);

    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(['Drugie życie', 'Romería', 'Tajny agent']);

    const tajny = rows.find((r) => r.title === 'Tajny agent')!;
    expect(tajny.sourceId).toBe('26919');
    expect(tajny.sourceUrl).toBe('https://kinomuranow.pl/film/tajny-agent');
    expect(tajny.category).toBe('cinema');
  });

  it('Muranów takes the deterministic path: no extractor, real rows off the fixture', async () => {
    // Every film page answers with the same synopsis, so the enrichment pass
    // (deterministic venues opt in via `enrich`) has something to fill in.
    const filmPage = '<html><head><meta property="og:description" content="Opis filmu."></head></html>';
    const fetcher = (async () => new Response(filmPage, { status: 200 })) as unknown as typeof fetch;

    const run = await scrapeVenue(muranowVenueId, {
      htmlOverride: muranowHtml,
      // Deliberately no extractor: reaching the LLM here would throw.
      fetcher,
      now: new Date('2026-06-07T08:00:00.000Z'),
      // This fixture carries 82 unique film pages — above the production
      // default cap of 50 — and the assertions below name a specific film.
      // Enrichment's pacing and cap have their own tests; this one is about
      // the deterministic parse, so it opts out of both.
      enrichDelayMs: 0,
      maxDetailFetches: 200,
    });

    expect(run.status).toBe('success');
    expect(run.eventsFound).toBe(143);

    const db = getDb();
    const rows = await db.select().from(schema.events);
    expect(rows).toHaveLength(143);

    const tajny = rows.find((r) => r.sourceId === '26919')!;
    expect(tajny.title).toBe('Tajny agent');
    expect(tajny.sourceUrl).toBe('https://kinomuranow.pl/film/tajny-agent');
    expect(tajny.category).toBe('cinema');
    // 17:00 Warsaw on 7 June = 15:00Z (CEST).
    expect(new Date(tajny.startsAt).toISOString()).toBe('2026-06-07T15:00:00.000Z');
    expect(tajny.description).toBe('Opis filmu.');
  });

  it('second run with identical HTML records status=skipped_unchanged', async () => {
    const ext = makeExtractor(expectedJson);
    const first = await scrapeVenue(venueId, {
      enrichDelayMs: 0,
      htmlOverride: muranowHtml,
      extractor: ext,
      now: new Date('2026-06-07T08:00:00.000Z'),
    });
    expect(first.status).toBe('success');

    const calls = { count: 0 };
    const second = await scrapeVenue(venueId, {
      enrichDelayMs: 0,
      htmlOverride: muranowHtml,
      extractor: { extract: async () => { calls.count++; return expectedJson; } },
      now: new Date('2026-06-07T08:00:00.000Z'),
    });
    expect(second.status).toBe('skipped_unchanged');
    expect(calls.count).toBe(0);

    const db = getDb();
    const rows = await db.select().from(schema.events);
    expect(rows).toHaveLength(3);
  });

  it('upserts: re-running with same source_id updates instead of duplicating', async () => {
    await scrapeVenue(venueId, {
      enrichDelayMs: 0,
      htmlOverride: muranowHtml,
      extractor: makeExtractor(expectedJson),
      now: new Date('2026-06-07T08:00:00.000Z'),
    });

    // Modify the expected payload: same source_id, different title.
    const mutated = JSON.parse(expectedJson) as { source_id: string | null; title: string }[];
    mutated[0]!.title = 'Tajny agent (reissue)';
    const mutatedJson = JSON.stringify(mutated);

    // Force=true bypasses hash check.
    const run = await scrapeVenue(venueId, {
      enrichDelayMs: 0,
      htmlOverride: muranowHtml + '<!-- bumped -->',
      extractor: makeExtractor(mutatedJson),
      force: true,
      now: new Date('2026-06-07T08:00:00.000Z'),
    });
    expect(run.status).toBe('success');

    const db = getDb();
    const rows = await db.select().from(schema.events);
    expect(rows).toHaveLength(3);
    const tajny = rows.find((r) => r.sourceId === '26919')!;
    expect(tajny.title).toBe('Tajny agent (reissue)');
  });

  it('prunes stale in-window events a successful scrape no longer sees; out-of-window rows survive', async () => {
    const now = new Date('2026-06-07T08:00:00.000Z'); // cinema window: 7 days
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      // A zombie row inside the scrape window (e.g. an earlier bad extraction)
      // and a row beyond the window the scrape has no authority over.
      await sql`
        INSERT INTO events (venue_id, title, starts_at, category, source_url, updated_at)
        VALUES
          (${venueId}, 'Zombie in window', '2026-06-10T18:00:00.000Z', 'cinema', 'https://kino-example.test/film/zombie', '2026-06-01T00:00:00.000Z'),
          (${venueId}, 'Beyond window', '2026-07-01T18:00:00.000Z', 'cinema', 'https://kino-example.test/film/beyond', '2026-06-01T00:00:00.000Z')`;
    } finally {
      await sql.end();
    }

    const run = await scrapeVenue(venueId, {
      enrichDelayMs: 0,
      htmlOverride: muranowHtml,
      extractor: makeExtractor(expectedJson),
      now,
    });
    expect(run.status).toBe('success');

    const db = getDb();
    const rows = await db.select().from(schema.events);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).not.toContain('Zombie in window'); // pruned: in window, untouched
    expect(titles).toContain('Beyond window'); // kept: outside the scraped window
    expect(titles).toEqual(expect.arrayContaining(['Drugie życie', 'Romería', 'Tajny agent']));
  });

  // ─── URL migration (0003) ──────────────────────────────────────────────────
  // The seed upserts ON CONFLICT (url), so a changed URL must be migrated in
  // place first — otherwise the seed inserts a duplicate venue with a new UUID.

  it('migration 0003 updates a changed venue URL in place; the seed upsert does not duplicate', async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      // Pre-migration state: Komediowy at the old homepage URL.
      await sql`DELETE FROM venues WHERE name = 'Klub Komediowy'`;
      await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Klub Komediowy', 'https://komediowy.pl/', 'Warsaw', 'PL', 'comedy', 'pl', 'Europe/Warsaw')`;

      await runMigrations(); // 0003: komediowy.pl/ → komediowy.pl/repertuar/

      // The post-migration seed then upserts with the NEW url.
      await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Klub Komediowy', 'https://komediowy.pl/repertuar/', 'Warsaw', 'PL', 'comedy', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name`;

      const rows = await sql<{ url: string }[]>`SELECT url FROM venues WHERE name = 'Klub Komediowy'`;
      expect(rows).toHaveLength(1); // updated in place, not duplicated
      expect(rows[0]!.url).toBe('https://komediowy.pl/repertuar/');
    } finally {
      await sql`DELETE FROM venues WHERE name = 'Klub Komediowy'`;
      await sql.end();
    }
  });

  it('migration 0007 moves MNW + Królikarnia from /wystawy to their event calendars in place', async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`DELETE FROM venues WHERE name IN ('Muzeum Narodowe', 'Królikarnia')`;
      await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES
          ('Muzeum Narodowe', 'https://mnw.art.pl/wystawy', 'Warsaw', 'PL', 'exhibition', 'pl', 'Europe/Warsaw'),
          ('Królikarnia', 'https://krolikarnia.mnw.art.pl/wystawy/', 'Warsaw', 'PL', 'exhibition', 'pl', 'Europe/Warsaw')`;

      await runMigrations(); // 0007: /wystawy → event calendar pages

      // The post-migration seed then upserts with the NEW urls.
      await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES
          ('Muzeum Narodowe', 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html', 'Warsaw', 'PL', 'exhibition', 'pl', 'Europe/Warsaw'),
          ('Królikarnia', 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html', 'Warsaw', 'PL', 'exhibition', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name`;

      const mnw = await sql<{ url: string }[]>`SELECT url FROM venues WHERE name = 'Muzeum Narodowe'`;
      expect(mnw).toHaveLength(1);
      expect(mnw[0]!.url).toBe('https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html');
      const krolikarnia = await sql<{ url: string }[]>`SELECT url FROM venues WHERE name = 'Królikarnia'`;
      expect(krolikarnia).toHaveLength(1);
      expect(krolikarnia[0]!.url).toBe('https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/{{MM-YYYY}},lista,miesiac.html');
    } finally {
      await sql`DELETE FROM venues WHERE name IN ('Muzeum Narodowe', 'Królikarnia')`;
      await sql.end();
    }
  });

  it('migration 0003 removes Muzeum Powstania and cascades its events + runs', async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`DELETE FROM venues WHERE url = 'https://1944.pl/wydarzenia'`;
      const ins = await sql<{ id: string }[]>`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Muzeum Powstania Warszawskiego', 'https://1944.pl/wydarzenia', 'Warsaw', 'PL', 'exhibition', 'pl', 'Europe/Warsaw')
        RETURNING id`;
      const vid = ins[0]!.id;
      await sql`INSERT INTO scrape_runs (venue_id, status) VALUES (${vid}, 'success')`;
      await sql`
        INSERT INTO events (venue_id, title, starts_at, category, source_url)
        VALUES (${vid}, 'Placeholder', now(), 'exhibition', 'https://1944.pl/x')`;

      await runMigrations(); // 0003: DELETE FROM venues WHERE url = '…1944.pl/wydarzenia'

      expect(await sql`SELECT 1 FROM venues WHERE id = ${vid}`).toHaveLength(0);
      expect(await sql`SELECT 1 FROM events WHERE venue_id = ${vid}`).toHaveLength(0); // cascade
      expect(await sql`SELECT 1 FROM scrape_runs WHERE venue_id = ${vid}`).toHaveLength(0); // cascade
    } finally {
      await sql`DELETE FROM venues WHERE url = 'https://1944.pl/wydarzenia'`;
      await sql.end();
    }
  });

  it('scrapeVenue fetches the date-resolved venue URL ({{YYYY-MM}} → current month)', async () => {
    const placeholderUrl = 'https://powszechny.example/repertuar?miesiac={{YYYY-MM}}';
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    let vid = '';
    try {
      await sql`DELETE FROM venues WHERE url = ${placeholderUrl}`;
      const ins = await sql<{ id: string }[]>`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Templated Venue', ${placeholderUrl}, 'Warsaw', 'PL', 'theatre', 'pl', 'Europe/Warsaw')
        RETURNING id`;
      vid = ins[0]!.id;

      let fetchedUrl = '';
      const fakeFetch = (async (u: string) => {
        fetchedUrl = String(u);
        return new Response('<html></html>', { status: 200 });
      }) as unknown as typeof fetch;

      // 22:00Z on the 18th is already the 19th in Warsaw — but still June, so
      // the month substitution is unambiguous.
      const run = await scrapeVenue(vid, {
      enrichDelayMs: 0,
        fetcher: fakeFetch,
        extractor: makeExtractor('[]'),
        now: new Date('2026-06-18T22:00:00.000Z'),
      });

      expect(fetchedUrl).toBe('https://powszechny.example/repertuar?miesiac=2026-06');
      expect(run.status).toBe('success_empty');
    } finally {
      if (vid) await sql`DELETE FROM venues WHERE id = ${vid}`;
      await sql.end();
    }
  });
});
