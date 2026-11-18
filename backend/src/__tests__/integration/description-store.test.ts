import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { runMigrations } from '../../db/migrate.js';
import { descriptionStore, DESCRIPTION_FORMAT } from '../../services/description-store.js';

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

const VENUE_URL = 'https://description-store.test/program';

describeIfDb('description store', () => {
  let venueId = '';

  beforeAll(async () => {
    await runMigrations();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const rows = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Store Test Hall', ${VENUE_URL}, 'Warsaw', 'PL', 'concert', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;
      venueId = (rows[0] as { id: string }).id;
      await sql`DELETE FROM event_descriptions WHERE venue_id = ${venueId}`;
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

  it('reads back what it saved', async () => {
    const store = descriptionStore(venueId);
    await store.save([{ key: 'https://description-store.test/a', description: 'A line.', longDescription: 'A paragraph.', contentCategory: 'music' }]);
    const got = await store.lookup(['https://description-store.test/a']);
    expect(got.get('https://description-store.test/a')?.description).toBe('A line.');
  });

  // The Polish site (#198) wrote rows as 'pl'. Rewriting one in English must
  // relabel it, or lookup skips it and every run pays for the show again.
  it('reads back a show rewritten over a row in another language', async () => {
    const key = 'https://description-store.test/polish';
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await sql`
        INSERT INTO event_descriptions (venue_id, show_key, description, lang, format)
        VALUES (${venueId}, ${key}, 'Po polsku.', 'pl', ${DESCRIPTION_FORMAT})`;
    } finally {
      await sql.end();
    }
    const store = descriptionStore(venueId);
    expect((await store.lookup([key])).has(key)).toBe(false);

    await store.save([{ key, description: 'In English.', longDescription: null, contentCategory: null }]);
    expect((await store.lookup([key])).get(key)?.description).toBe('In English.');
  });
});
