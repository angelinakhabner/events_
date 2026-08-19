import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { saveEvents } from './persister.js';
import type { ValidatedEvent } from './validator.js';
import type { Venue } from '@afisz/shared';

const HAS_DB = !!process.env.DATABASE_URL;
const describeIfDb = HAS_DB ? describe : describe.skip;

const VENUE_URL = 'https://persister-example.test/program';

/**
 * The upsert's "don't lose what an earlier run learned" rules (GOI-90).
 *
 * Enrichment deliberately skips detail pages it has already described, so
 * every sweep after the first hands the persister rows whose description is
 * null and whose content category fell back to the know-nothing answer. These
 * cases pin down which of those the stored row wins, and which it doesn't.
 */
describeIfDb('saveEvents: re-scrape must not downgrade enriched fields', () => {
  let venueId = '';
  const venue = (): Pick<Venue, 'id' | 'category' | 'language'> => ({
    id: venueId,
    category: 'theatre',
    language: 'pl',
  });

  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const rows = await sql`
        INSERT INTO venues (name, url, city, country, category, language, timezone)
        VALUES ('Persister Example', ${VENUE_URL}, 'Warsaw', 'PL', 'theatre', 'pl', 'Europe/Warsaw')
        ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;
      venueId = (rows[0] as { id: string }).id;
    } finally {
      await sql.end();
    }
  });

  beforeEach(async () => {
    await getDb().delete(schema.events).where(eq(schema.events.venueId, venueId));
  });

  const row = (over: Partial<ValidatedEvent> = {}): ValidatedEvent =>
    ({
      title: 'Wieczór autorski',
      description: null,
      starts_at: '2026-09-10T18:00:00.000Z',
      ends_at: null,
      kind: 'timed',
      language: 'pl',
      director: null,
      cast: null,
      duration_minutes: null,
      price_min: null,
      price_max: null,
      source_url: 'https://persister-example.test/e/1',
      source_id: 'e1',
      ...over,
    }) as ValidatedEvent;

  const stored = async () =>
    (await getDb().select().from(schema.events).where(eq(schema.events.venueId, venueId)))[0]!;

  it('keeps a stored description when the re-scraped row has none', async () => {
    await saveEvents(venue(), [row({ description: 'Spotkanie z autorem.' })]);
    await saveEvents(venue(), [row({ description: null })]);
    expect((await stored()).description).toBe('Spotkanie z autorem.');
  });

  it('applies a description that actually changed', async () => {
    await saveEvents(venue(), [row({ description: 'Stary opis.' })]);
    await saveEvents(venue(), [row({ description: 'Nowy opis.' })]);
    expect((await stored()).description).toBe('Nowy opis.');
  });

  it('keeps an llm content category when the re-scrape can derive nothing', async () => {
    // 'Wieczór autorski' matches no keyword and is not exhibition-shaped, so
    // only the model could have filed it — and only enrichment supplies that.
    await saveEvents(venue(), [row({ content_category: 'lecture' } as Partial<ValidatedEvent>)]);
    expect((await stored()).categorySource).toBe('llm');

    await saveEvents(venue(), [row()]); // enrichment skipped: no content_category
    const after = await stored();
    expect(after.contentCategory).toBe('lecture');
    expect(after.categorySource).toBe('llm');
  });

  it('lets a keyword hit overwrite a stored llm category', async () => {
    await saveEvents(venue(), [row({ content_category: 'concert' } as Partial<ValidatedEvent>)]);
    expect((await stored()).categorySource).toBe('llm');

    // A title the keyword pass can read is a real answer about the row itself.
    await saveEvents(venue(), [row({ title: 'Warsztaty ceramiczne' })]);
    const after = await stored();
    expect(after.contentCategory).toBe('workshop');
    expect(after.categorySource).toBe('keyword');
  });

  it('lets the structural answer overwrite a stored llm category', async () => {
    await saveEvents(venue(), [row({ content_category: 'concert' } as Partial<ValidatedEvent>)]);
    expect((await stored()).categorySource).toBe('llm');

    await saveEvents(venue(), [
      row({ kind: 'exhibition', ends_at: '2026-11-30T00:00:00.000Z' } as Partial<ValidatedEvent>),
    ]);
    const after = await stored();
    expect(after.contentCategory).toBe('exhibition');
    expect(after.categorySource).toBe('structural');
  });

  it('applies a fresh llm category over an older one', async () => {
    await saveEvents(venue(), [row({ content_category: 'concert' } as Partial<ValidatedEvent>)]);
    await saveEvents(venue(), [row({ content_category: 'lecture' } as Partial<ValidatedEvent>)]);
    const after = await stored();
    expect(after.contentCategory).toBe('lecture');
    expect(after.categorySource).toBe('llm');
  });
});
