import { sql, and, eq, gte, inArray, lte, lt } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import type { ValidatedEvent } from './validator.js';
import { classifyEvent, type Venue } from '@afisz/shared';

export interface PersistResult {
  inserted: number;
  updated: number;
}

/**
 * "The incoming row learned nothing, and the stored one was classified by the
 * model" — the open half of the CASE the upsert's classification columns use.
 * ('other', 'keyword') is exactly what `classifyEvent` returns when neither
 * the structure nor a keyword matched and no model answer was available.
 *
 * Built on call rather than held in a module-level constant: `schema` is not
 * necessarily initialised when this module is first evaluated, and reading a
 * column off it at import time throws in module graphs that reach the runner
 * before the schema.
 */
const keepLlmClassification = () => sql`case when excluded.content_category = 'other'
  and excluded.category_source = 'keyword'
  and ${schema.events.categorySource} = 'llm'`;

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
      // Only an exhibition's closing date is stored (GOI-67). The validator
      // rejects a multi-day span on a timed row, so anything left here would
      // be same-day noise the listing has no use for.
      endsAt: e.kind === 'exhibition' && e.ends_at ? new Date(e.ends_at) : null,
      kind: e.kind,
      category: venue.category,
      language: e.language ?? venue.language ?? null,
      director: e.director,
      cast: e.cast ?? null,
      durationMinutes: e.duration_minutes,
      priceMin: e.price_min,
      priceMax: e.price_max,
      sourceUrl: e.source_url,
      sourceId: e.source_id ?? null,
      // GOI-80. The structural shape is decided here, from the row's own
      // dates, and outranks anything the keyword pass or the model says —
      // `kind` selects the date predicate at query time, so a guess there
      // breaks filtering rather than merely mislabelling a chip.
      ...classifyRow(e),
      scrapedAt: now,
      updatedAt: now,
    };

    const set = {
      title: values.title,
      // Never let a re-scrape blank a description we already have (GOI-90).
      // Enrichment skips detail pages whose description is already stored —
      // that skip is the whole cost saving — so on every sweep after the
      // first, a row arrives here with `description: null` and no new
      // information about it. Writing that null over the stored text made
      // descriptions flip-flop: present, gone, re-fetched (and re-billed),
      // gone again. A non-null incoming value still wins, so a venue that
      // genuinely rewrote its blurb is applied; null now means "I learned
      // nothing this run", which is not the same as "there is nothing".
      description: sql`coalesce(excluded.description, ${schema.events.description})`,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      kind: values.kind,
      language: values.language,
      director: values.director,
      cast: values.cast,
      durationMinutes: values.durationMinutes,
      priceMin: values.priceMin,
      priceMax: values.priceMax,
      sourceUrl: values.sourceUrl,
      // Same trap as `description` above, one field over (GOI-90). The model's
      // content category rides back on the *enrichment* call, so a sweep that
      // skipped the detail page has no `content_category` to classify from and
      // `classifyEvent` lands on its know-nothing fallback — ('other',
      // 'keyword'). Writing that over a stored 'llm' answer silently demotes a
      // correctly-filed lecture to 'other' and drops it out of the category
      // chips. Structure and keywords still overwrite freely, because those
      // are real answers derived from the row itself; only the fallback defers.
      contentCategory: sql`${keepLlmClassification()} then ${schema.events.contentCategory} else excluded.content_category end`,
      categorySource: sql`${keepLlmClassification()} then ${schema.events.categorySource} else excluded.category_source end`,
      audience: values.audience,
      // An event the venue is listing again is not cancelled any more. Left
      // set, a run that was pulled and reinstated would stay invisible for
      // good (GOI-101).
      cancelledAt: null,
      scrapedAt: values.scrapedAt,
      updatedAt: values.updatedAt,
    };

    // Drizzle's onConflictDoUpdate accepts a `target` of columns and a
    // `targetWhere` predicate, which matches the partial unique indexes
    // declared in 0001_events.sql.
    const returning = {
      id: schema.events.id,
      isInsert: sql<boolean>`(xmax = 0)`,
      // The stored value, read before the update overwrites it, so a moved
      // showtime can be reported to whoever saved it (GOI-101).
      previousStartsAt: sql<string | null>`${schema.events.startsAt}`,
      wasCancelled: sql<string | null>`${schema.events.cancelledAt}`,
    };
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

    const row = result[0];
    if (row?.isInsert) inserted++;
    else updated++;

    // A reschedule is only observable on the `source_id` key. Keyed on
    // (venue_id, source_url, starts_at), a moved showtime is a different row
    // by definition — it arrives as an insert and the old one is pruned — so
    // there is no before-and-after to compare. Venues with stable ids get the
    // signal; the rest fall back to the cancellation the prune records.
    if (row && !row.isInsert && values.sourceId && row.previousStartsAt) {
      const before = new Date(row.previousStartsAt);
      if (before.getTime() !== values.startsAt.getTime()) {
        await recordEventChange(row.id, 'rescheduled', row.previousStartsAt, values.startsAt.toISOString());
      }
    }
  }

  return { inserted, updated };
}

/**
 * Note a change to an event that already existed (GOI-101).
 *
 * Append-only: a rescheduled-then-cancelled event has two rows, and the
 * newsletter reports both, because the second does not make the first untrue.
 */
export async function recordEventChange(
  eventId: string,
  changeType: 'cancelled' | 'rescheduled' | 'moved' | 'sold_out',
  oldValue: string | null,
  newValue: string | null,
): Promise<void> {
  await getDb().insert(schema.eventChanges).values({ eventId, changeType, oldValue, newValue });
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
  const stale = and(
    eq(schema.events.venueId, venueId),
    gte(schema.events.startsAt, args.windowStart),
    lte(schema.events.startsAt, args.windowEnd),
    lt(schema.events.updatedAt, args.olderThan),
  );

  /**
   * Rows somebody saved are cancelled, not deleted (GOI-101).
   *
   * `want_to_go.event_id` cascades, so deleting one took the reader's bookmark
   * with it — and a newsletter cannot tell someone their saved event was
   * cancelled if cancelling it also erases the record that they saved it. The
   * row is kept, stamped, and dropped from every listing by `cancelled_at IS
   * NULL`; the reader's list keeps it, which is where the fact belongs.
   *
   * This is the inference GOI-101 warns about, and the caller is what makes it
   * safe: `pruneStaleEvents` runs only after a scrape that succeeded *and*
   * returned events for this venue, so a failed fetch or a restructured page
   * cannot be read as a room full of cancellations. A false cancellation is
   * far worse than a missed one.
   */
  const saved = await db
    .select({ id: schema.events.id, startsAt: schema.events.startsAt })
    .from(schema.events)
    .innerJoin(schema.wantToGo, eq(schema.wantToGo.eventId, schema.events.id))
    .where(and(stale, sql`${schema.events.cancelledAt} is null`));

  const savedIds = [...new Set(saved.map((r) => r.id))];
  if (savedIds.length > 0) {
    await db
      .update(schema.events)
      .set({ cancelledAt: new Date() })
      .where(inArray(schema.events.id, savedIds));
    for (const row of saved) {
      await recordEventChange(row.id, 'cancelled', row.startsAt?.toISOString() ?? null, null);
    }
  }

  const deleted = await db
    .delete(schema.events)
    .where(and(stale, sql`${schema.events.cancelledAt} is null`))
    .returning({ id: schema.events.id });
  return deleted.length + savedIds.length;
}

/**
 * One row's classification (GOI-80), decided at save time.
 *
 * A conflict between the structure and the model is logged and discarded, not
 * applied: the structure is what the date predicate keys off.
 */
function classifyRow(e: {
  title: string;
  kind?: string;
  content_category?: unknown;
}): { contentCategory: string; categorySource: string; audience: string | null } {
  const result = classifyEvent({
    title: e.title,
    isExhibitionShape: e.kind === 'exhibition',
    llmCategory: typeof e.content_category === 'string' ? e.content_category : null,
  });
  if (result.conflict) {
    console.warn(`[classify] ${e.title}: ${result.conflict}`);
  }
  return {
    contentCategory: result.contentCategory,
    categorySource: result.categorySource,
    audience: result.audience,
  };
}
