import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getDb, schema } from '../../db/index.js';
import { scrapeVenue } from '../../services/scraper/runner.js';
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
});
