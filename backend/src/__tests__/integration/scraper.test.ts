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

describeIfDb('scraper integration', () => {
  let venueId = '';

  beforeAll(async () => {
    muranowHtml = await fs.readFile(path.join(fixtureDir, 'muranow.html'), 'utf-8');
    expectedJson = await fs.readFile(path.join(fixtureDir, 'muranow-expected.json'), 'utf-8');

    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
      // Ensure Muranów venue exists in DB. INSERT...RETURNING gets us its UUID.
      const rows = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Kino Muranów', 'https://kinomuranow.pl/repertuar', 'Warsaw', 'PL', 'cinema', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;
      venueId = (rows[0] as { id: string }).id;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`TRUNCATE events, scrape_runs RESTART IDENTITY CASCADE`;
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

  it('second run with identical HTML records status=skipped_unchanged', async () => {
    const ext = makeExtractor(expectedJson);
    const first = await scrapeVenue(venueId, {
      htmlOverride: muranowHtml,
      extractor: ext,
      now: new Date('2026-06-07T08:00:00.000Z'),
    });
    expect(first.status).toBe('success');

    const calls = { count: 0 };
    const second = await scrapeVenue(venueId, {
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
