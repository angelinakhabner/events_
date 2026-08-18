import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
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
  /**
   * Start the listing at this Europe/Warsaw calendar day, YYYY-MM-DD, rather
   * than at `now` (GOI-88).
   *
   * Narrowed in SQL for the same reason as `categories`, and broken the same
   * way when it isn't: `limit` cuts the *globally* earliest rows, so a caller
   * that fetches the next 100 events and then keeps Friday's gets whatever
   * Friday survived a list that today's cinema programme had already filled.
   * That is what made the day strip look inert — "Fri 21 Aug" was a real
   * click on a real filter over rows that stopped at Wednesday.
   */
  fromDay?: string;
  /** Optional closing edge of the window, inclusive. Left off, the listing
   *  runs from `fromDay` into the future — which is what lets one query
   *  answer both "what's on Thursday" and "…and if nothing, what's next". */
  toDay?: string;
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
    if (input.fromDay) conditions.push(warsawDayWindow(input.fromDay, input.toDay));
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

  /**
   * Per-venue event counts for the filter row (GOI-76 §6).
   *
   * One grouped query, not one per venue — a category with sixteen venues
   * would otherwise cost sixteen round trips on every date click.
   *
   * The counts deliberately know nothing about which venues are *selected*.
   * Applying the selection before counting is the easy bug the ticket calls
   * out: every unselected venue would read 0 the moment anything was picked,
   * and the row would destroy its own usefulness on first use.
   *
   * `LEFT JOIN` rather than an inner one so a venue with nothing on still
   * comes back, with a zero. A visible zero says "watched, nothing on", which
   * is different from the venue not being covered at all.
   */
  async venueFilterCounts(input: {
    category?: Category;
    city?: string;
    /** Inclusive Warsaw calendar-day window, YYYY-MM-DD — one day when the
     *  strip names a date, seven when it says "this week". */
    fromDay?: string;
    toDay?: string;
    /** Keep events starting at or after this Warsaw hour. */
    fromHour?: number;
    now?: Date;
  }): Promise<VenueFilterCountRow[]> {
    const db = getDb();
    const now = input.now ?? new Date();

    // Both counts come from the same scan: one narrowed by the day/time
    // filters, one not. The second is what tells "nothing on this Tuesday"
    // apart from "nothing on at all", which is the difference between an
    // `active` chip reading 0 and an `empty` one.
    const inFilter = [
      sql`e.id IS NOT NULL`,
      input.fromDay && input.toDay
        ? sql`(CASE WHEN e.kind = 'exhibition'
            THEN (e.starts_at AT TIME ZONE 'Europe/Warsaw')::date <= ${input.toDay}::date
                 AND (e.ends_at IS NULL
                      OR (e.ends_at AT TIME ZONE 'Europe/Warsaw')::date >= ${input.fromDay}::date)
            ELSE (e.starts_at AT TIME ZONE 'Europe/Warsaw')::date
                 BETWEEN ${input.fromDay}::date AND ${input.toDay}::date
          END)`
        : sql`true`,
      input.fromHour !== undefined
        ? sql`extract(hour from e.starts_at AT TIME ZONE 'Europe/Warsaw') >= ${input.fromHour}`
        : sql`true`,
    ];

    const rows = await db.execute(sql`
      SELECT
        v.id,
        v.name,
        v.category,
        v.probe_error_code,
        count(e.id) FILTER (WHERE ${sql.join(inFilter, sql` AND `)}) AS in_filter,
        count(e.id) AS upcoming_total,
        max(e.scraped_at) AS last_scraped_at
      FROM venues v
      LEFT JOIN events e
        ON e.venue_id = v.id
        -- "Upcoming" has to mean the same thing it means in the listing
        -- (GOI-67): an exhibition that opened in June and closes in September
        -- is on today, and is selected by its closing date.
        AND (e.starts_at >= ${now} OR (e.kind = 'exhibition' AND e.ends_at >= ${now}))
      WHERE ${input.category ? sql`v.category = ${input.category}` : sql`true`}
        AND ${input.city ? sql`v.city = ${input.city}` : sql`true`}
      GROUP BY v.id, v.name, v.category, v.probe_error_code
    `);

    return unwrap(rows).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      category: String(r.category) as Category,
      probeErrorCode: r.probe_error_code === null ? null : String(r.probe_error_code),
      count: Number(r.in_filter ?? 0),
      upcomingTotal: Number(r.upcoming_total ?? 0),
      lastScrapedAt: r.last_scraped_at ? new Date(r.last_scraped_at as string).toISOString() : null,
    }));
  }

  /**
   * Which of these detail URLs already have a stored description (GOI-79).
   *
   * This is what makes a re-scrape cheap. A monthly theatre programme
   * re-parsed every night would otherwise re-fetch and re-extract every show
   * on it, every night, for a description that hasn't changed since the first
   * time. Scoped to the venue so one venue's rows can't answer for another's.
   */
  async describedSourceUrls(venueId: string, urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const rows = await getDb()
      .select({ sourceUrl: schema.events.sourceUrl })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.venueId, venueId),
          inArray(schema.events.sourceUrl, urls),
          isNotNull(schema.events.description),
          // A row saved with an empty-string description is not described.
          sql`length(trim(${schema.events.description})) > 0`,
        ),
      );
    return new Set(rows.map((r) => r.sourceUrl));
  }
}

/**
 * "Falls inside this Warsaw day window" — as a timed event's start day, or as
 * an exhibition's run overlapping it (GOI-67).
 *
 * The dates are compared after converting to Warsaw, not in UTC: a 23:00
 * screening is stored as 21:00Z, and asking UTC for its day answers with the
 * day before, for roughly a tenth of the programme.
 */
function warsawDayWindow(fromDay: string, toDay?: string) {
  const startDay = sql`(${schema.events.startsAt} AT TIME ZONE 'Europe/Warsaw')::date`;
  const endDay = sql`(${schema.events.endsAt} AT TIME ZONE 'Europe/Warsaw')::date`;
  const notAfter = toDay ? sql`${startDay} <= ${toDay}::date` : sql`true`;
  return sql`(CASE WHEN ${schema.events.kind} = 'exhibition'
    THEN ${notAfter}
         AND (${schema.events.endsAt} IS NULL OR ${endDay} >= ${fromDay}::date)
    ELSE ${startDay} >= ${fromDay}::date AND ${notAfter}
  END)`;
}

export const defaultEventStore = new EventStore();

/** One venue's raw numbers for the filter row, before status is derived. */
export interface VenueFilterCountRow {
  id: string;
  name: string;
  category: Category;
  probeErrorCode: string | null;
  count: number;
  upcomingTotal: number;
  lastScrapedAt: string | null;
}

/** drizzle's `execute` returns either an array or a `{ rows }` wrapper
 *  depending on the driver; normalise before reading. */
function unwrap(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const r = (result as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as Record<string, unknown>[];
  }
  return [];
}

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
