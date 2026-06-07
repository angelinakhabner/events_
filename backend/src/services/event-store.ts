import { and, asc, eq, gte } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Event, Category } from '@goin/shared';

export interface EventListInput {
  city?: string;
  venueId?: string;
  /** Hard upper bound on rows. */
  limit?: number;
  now?: Date;
}

export class EventStore {
  async listUpcoming(input: EventListInput = {}): Promise<Event[]> {
    const db = getDb();
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

    const conditions = [gte(schema.events.startsAt, now)];
    if (input.venueId) conditions.push(eq(schema.events.venueId, input.venueId));
    if (input.city) conditions.push(eq(schema.venues.city, input.city));

    const rows = await db
      .select({
        e: schema.events,
        venueLanguage: schema.venues.language,
      })
      .from(schema.events)
      .innerJoin(schema.venues, eq(schema.events.venueId, schema.venues.id))
      .where(and(...conditions))
      .orderBy(asc(schema.events.startsAt))
      .limit(limit);

    return rows.map(({ e, venueLanguage }) => rowToEvent(e, venueLanguage));
  }
}

export const defaultEventStore = new EventStore();

function rowToEvent(row: typeof schema.events.$inferSelect, venueLanguage: string): Event {
  return {
    id: row.id,
    venueId: row.venueId,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    category: row.category as Category,
    language: row.language ?? venueLanguage ?? null,
    director: row.director,
    cast: row.cast ?? [],
    durationMinutes: row.durationMinutes,
    priceMin: row.priceMin,
    priceMax: row.priceMax,
    sourceUrl: row.sourceUrl,
    sourceId: row.sourceId,
    scrapedAt: row.scrapedAt.toISOString(),
  };
}
