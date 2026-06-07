import { sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import type { ValidatedEvent } from './validator.js';
import type { Venue } from '@goin/shared';

export interface PersistResult {
  inserted: number;
  updated: number;
}

/**
 * Upserts events into the DB.
 *
 * Dedup strategy: if `source_id` is set, key on (venue_id, source_id).
 * Otherwise fall back to (venue_id, source_url, starts_at). Two partial
 * unique indexes back this (see migration 0001_events.sql).
 */
export async function saveEvents(
  venue: Pick<Venue, 'id' | 'category' | 'language'>,
  events: ValidatedEvent[],
): Promise<PersistResult> {
  if (events.length === 0) return { inserted: 0, updated: 0 };
  const db = getDb();
  const now = new Date();

  let inserted = 0;
  let updated = 0;

  for (const e of events) {
    const row = {
      venueId: venue.id,
      title: e.title,
      description: e.description,
      startsAt: new Date(e.starts_at),
      endsAt: null as Date | null,
      category: venue.category,
      language: e.language ?? venue.language ?? null,
      director: e.director,
      cast: e.cast,
      durationMinutes: e.duration_minutes,
      priceMin: e.price_min,
      priceMax: e.price_max,
      sourceUrl: e.source_url,
      sourceId: e.source_id ?? null,
      scrapedAt: now,
      updatedAt: now,
    };

    // Drizzle doesn't yet support partial-index targets natively, so use raw SQL.
    const result = await db.execute(sql`
      INSERT INTO events (
        venue_id, title, description, starts_at, ends_at, category, language,
        director, "cast", duration_minutes, price_min, price_max,
        source_url, source_id, scraped_at, updated_at
      ) VALUES (
        ${row.venueId}::uuid, ${row.title}, ${row.description}, ${row.startsAt}, ${row.endsAt},
        ${row.category}, ${row.language}, ${row.director}, ${row.cast as string[] | null},
        ${row.durationMinutes}, ${row.priceMin}, ${row.priceMax},
        ${row.sourceUrl}, ${row.sourceId}, ${row.scrapedAt}, ${row.updatedAt}
      )
      ON CONFLICT ${row.sourceId
        ? sql`(venue_id, source_id) WHERE source_id IS NOT NULL`
        : sql`(venue_id, source_url, starts_at) WHERE source_id IS NULL`}
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        language = EXCLUDED.language,
        director = EXCLUDED.director,
        "cast" = EXCLUDED."cast",
        duration_minutes = EXCLUDED.duration_minutes,
        price_min = EXCLUDED.price_min,
        price_max = EXCLUDED.price_max,
        source_url = EXCLUDED.source_url,
        scraped_at = EXCLUDED.scraped_at,
        updated_at = EXCLUDED.updated_at
      RETURNING (xmax = 0) AS inserted
    `);

    const rows = (result as unknown as { rows?: { inserted: boolean }[] }).rows
      ?? (result as unknown as { inserted: boolean }[]);
    const first = Array.isArray(rows) ? rows[0] : undefined;
    if (first?.inserted) inserted++;
    else updated++;
  }

  // Reference unused schema to keep the import alive for callers that
  // type-check against it.
  void schema;
  return { inserted, updated };
}
