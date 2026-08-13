import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Event, EventKind, EventVenue, Category } from '@afisz/shared';

export interface EventListInput {
  city?: string;
  venueId?: string;
  /** Restrict to a set of venues — the newsletter's "my venues" selection.
   *  Narrowing in SQL matters: `limit` cuts the *globally* earliest rows, so
   *  filtering by venue afterwards can leave a caller with nothing. */
  venueIds?: string[];
  /**
   * Restrict to these event categories (GOI-70).
   *
   * Same reasoning as `venueIds`, and the same bug when it's missing: `limit`
   * cuts the globally earliest rows, so a caller that fetches "the next 100
   * events" and *then* keeps the music ones gets whatever music happened to
   * survive a list dominated by cinema — which is none of it, because a
   * cinema publishes eight screenings a day and a concert hall publishes one
   * a week.
   */
  categories?: Category[];
  /** Exact title, matched case-insensitively — same film at every cinema. */
  title?: string;
  /** Upper bound on start time — the caller's window, e.g. a week ahead. */
  until?: Date;
  /** Hard upper bound on rows. */
  limit?: number;
  now?: Date;
}

/** How busy a venue's calendar is right now — the raw input to the "dark
 *  until…" notice on /my (GOI-13). */
export interface VenueActivity {
  venueId: string;
  /** ISO start of the soonest upcoming event, or null when there is none. */
  nextStartsAt: string | null;
  upcomingCount: number;
}

export class EventStore {
  async listUpcoming(input: EventListInput = {}): Promise<Event[]> {
    const db = getDb();
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

    // "Upcoming" means something different for a run than for a showtime
    // (GOI-67): an exhibition that opened in June and closes in September is
    // on *today*, so it is selected by its closing date. Comparing its
    // `starts_at` to now — the only rule this query used to have — hid every
    // exhibition the morning after it opened.
    const conditions = [
      or(
        gte(schema.events.startsAt, now),
        and(eq(schema.events.kind, 'exhibition'), gte(schema.events.endsAt, now)),
      )!,
    ];
    if (input.until) conditions.push(lte(schema.events.startsAt, input.until));
    if (input.venueId) conditions.push(eq(schema.events.venueId, input.venueId));
    // An explicitly empty list means "no venues", not "all of them" — matching
    // it to nothing is what keeps a subscriber with no venues from being
    // briefed on the whole database.
    if (input.venueIds) conditions.push(inArray(schema.events.venueId, input.venueIds));
    // Empty means "no categories" for the same reason an empty venueIds means
    // "no venues": an explicit empty selection is not "everything".
    if (input.categories) conditions.push(inArray(schema.events.category, input.categories));
    if (input.city) conditions.push(eq(schema.venues.city, input.city));
    if (input.title) {
      conditions.push(sql`lower(${schema.events.title}) = lower(${input.title})`);
    }

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

  /**
   * Per-venue upcoming activity: when the next event is, and how many are
   * listed. Venues with nothing upcoming are returned with a null date and a
   * zero count rather than being omitted, so a caller can tell "dark" apart
   * from "not asked about" (GOI-13).
   */
  async venueActivity(
    venueIds: string[],
    now: Date = new Date(),
  ): Promise<VenueActivity[]> {
    if (venueIds.length === 0) return [];
    const rows = await getDb()
      .select({
        venueId: schema.events.venueId,
        nextStartsAt: sql<Date | null>`min(${schema.events.startsAt})`,
        upcomingCount: sql<number>`count(*)::int`,
      })
      .from(schema.events)
      .where(
        and(
          inArray(schema.events.venueId, venueIds),
          // Same reasoning as listUpcoming: a museum running a three-month
          // show is not dark, even though nothing *starts* in the future.
          or(
            gte(schema.events.startsAt, now),
            and(eq(schema.events.kind, 'exhibition'), gte(schema.events.endsAt, now)),
          ),
        ),
      )
      .groupBy(schema.events.venueId);

    const found = new Map(
      rows.map((r) => [
        r.venueId,
        {
          venueId: r.venueId,
          // drizzle hands back whatever pg's driver parsed; normalise to ISO.
          nextStartsAt: r.nextStartsAt ? new Date(r.nextStartsAt).toISOString() : null,
          upcomingCount: Number(r.upcomingCount),
        },
      ]),
    );
    return venueIds.map(
      (id) => found.get(id) ?? { venueId: id, nextStartsAt: null, upcomingCount: 0 },
    );
  }

  /** Events by id (any date — a saved event stays visible until it passes),
   *  venue summary inlined. Order is unspecified; callers sort. */
  async listByIds(ids: string[]): Promise<Event[]> {
    if (ids.length === 0) return [];
    const rows = await getDb()
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
      .where(inArray(schema.events.id, ids));
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
    kind: row.kind === 'exhibition' ? 'exhibition' : ('timed' as EventKind),
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
