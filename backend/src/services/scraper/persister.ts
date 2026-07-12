import { sql, and, eq, gte, lte, lt } from 'drizzle-orm';
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
    const values = {
      venueId: venue.id,
      title: e.title,
      description: e.description,
      startsAt: new Date(e.starts_at),
      endsAt: null,
      category: venue.category,
      language: e.language ?? venue.language ?? null,
      director: e.director,
      cast: e.cast ?? null,
      durationMinutes: e.duration_minutes,
      priceMin: e.price_min,
      priceMax: e.price_max,
      sourceUrl: e.source_url,
      sourceId: e.source_id ?? null,
      scrapedAt: now,
      updatedAt: now,
    };

    const set = {
      title: values.title,
      description: values.description,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      language: values.language,
      director: values.director,
      cast: values.cast,
      durationMinutes: values.durationMinutes,
      priceMin: values.priceMin,
      priceMax: values.priceMax,
      sourceUrl: values.sourceUrl,
      scrapedAt: values.scrapedAt,
      updatedAt: values.updatedAt,
    };

    // Drizzle's onConflictDoUpdate accepts a `target` of columns and a
    // `targetWhere` predicate, which matches the partial unique indexes
    // declared in 0001_events.sql.
    const returning = { id: schema.events.id, isInsert: sql<boolean>`(xmax = 0)` };
    const result = await (values.sourceId
      ? db
          .insert(schema.events)
          .values(values)
          .onConflictDoUpdate({
            target: [schema.events.venueId, schema.events.sourceId],
            targetWhere: sql`source_id IS NOT NULL`,
            set,
          })
          .returning(returning)
      : db
          .insert(schema.events)
          .values(values)
          .onConflictDoUpdate({
            target: [schema.events.venueId, schema.events.sourceUrl, schema.events.startsAt],
            targetWhere: sql`source_id IS NULL`,
            set,
          })
          .returning(returning));

    if (result[0]?.isInsert) inserted++;
    else updated++;
  }

  return { inserted, updated };
}

/**
 * Delete this venue's events that a just-completed scrape should have seen but
 * didn't: rows starting inside the scraped window whose `updated_at` predates
 * the run. A successful scrape is authoritative for its window — anything it
 * didn't touch was cancelled, rescheduled, or (the Kinoteka case) created by an
 * earlier buggy extraction with a wrong date, and `saveEvents` alone can never
 * remove it. Rows beyond the window are left alone: the scrape never looked
 * there, so it has no authority over them (they get reconciled once the
 * advancing window reaches them).
 */
export async function pruneStaleEvents(
  venueId: string,
  args: { windowStart: Date; windowEnd: Date; olderThan: Date },
): Promise<number> {
  const db = getDb();
  const deleted = await db
    .delete(schema.events)
    .where(
      and(
        eq(schema.events.venueId, venueId),
        gte(schema.events.startsAt, args.windowStart),
        lte(schema.events.startsAt, args.windowEnd),
        lt(schema.events.updatedAt, args.olderThan),
      ),
    )
    .returning({ id: schema.events.id });
  return deleted.length;
}
