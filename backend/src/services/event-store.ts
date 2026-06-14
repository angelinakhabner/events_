import { and, asc, eq, gte } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Event, EventVenue, Category } from '@goin/shared';

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

    // INNER JOIN is intentional: an event without a venue is meaningless and
    // by FK can't exist anyway. We carry the venue summary inline so the
    // frontend doesn't need a separate venues.list call — which was the
    // source of the "Unknown venue" bug when the two queries drifted.
    const rows = await db
      .select({
        e: schema.events,
        venueId: schema.venues.id,
        venueName: schema.venues.name,
        venueCategory: schema.venues.category,
        venueCity: schema.venues.city,
        venueCountry: schema.venues.country,
        venueLanguage: schema.venues.language,
      })
      .from(schema.events)
      .innerJoin(schema.venues, eq(schema.events.venueId, schema.venues.id))
      .where(and(...conditions))
      .orderBy(asc(schema.events.startsAt))
      .limit(limit);

    return rows.map((r) =>
      rowToEvent(r.e, {
        venue: {
          id: r.venueId,
          name: r.venueName,
          category: r.venueCategory as Category,
          city: r.venueCity,
          country: r.venueCountry,
        },
        venueLanguage: r.venueLanguage,
      }),
    );
  }
}

export const defaultEventStore = new EventStore();

function rowToEvent(
  row: typeof schema.events.$inferSelect,
  ctx: { venue: EventVenue; venueLanguage: string },
): Event {
  return {
    id: row.id,
    venueId: row.venueId,
    venue: ctx.venue,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    category: row.category as Category,
    language: row.language ?? ctx.venueLanguage ?? null,
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
