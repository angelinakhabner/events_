import { createHash } from 'node:crypto';
import { eq, desc, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { fetchVenueHTML } from './fetcher.js';
import { preprocessForVenue } from './preprocessor.js';
import { extractEvents, type ExtractorClient } from './extractor.js';
import { validateEvents } from './validator.js';
import { saveEvents } from './persister.js';
import type { Venue, ScrapeRun } from '@goin/shared';

export interface ScrapeOptions {
  force?: boolean;
  /** Inject a pre-fetched HTML (skips network). Used by tests + admin. */
  htmlOverride?: string;
  /** Inject Anthropic client (used in tests). */
  extractor?: ExtractorClient;
  /** Inject fetch implementation. */
  fetcher?: typeof fetch;
  /** Reference "now" for relative date math. Defaults to new Date(). */
  now?: Date;
}

export async function scrapeVenue(venueId: string, opts: ScrapeOptions = {}): Promise<ScrapeRun> {
  const db = getDb();
  const venueRows = await db.select().from(schema.venues).where(eq(schema.venues.id, venueId)).limit(1);
  const venue = venueRows[0];
  if (!venue) {
    throw new Error(`Venue ${venueId} not found`);
  }

  const startedAt = new Date();
  const [run] = await db
    .insert(schema.scrapeRuns)
    .values({ venueId, status: 'running', startedAt })
    .returning();
  if (!run) throw new Error('Failed to create scrape_runs row');

  const finalize = async (patch: Partial<typeof schema.scrapeRuns.$inferInsert>): Promise<ScrapeRun> => {
    // Drizzle's typed `.update().set().where()` was observed in CI not to
    // actually persist the row — finalize's returning came back empty and a
    // subsequent SELECT couldn't find the just-updated row. Use raw SQL via
    // db.execute and RETURNING to guarantee a single round-trip that both
    // persists and returns the row.
    const finishedAt = new Date();
    const status = patch.status ?? 'failed';
    const eventsFound = patch.eventsFound ?? null;
    const errorMessage = patch.errorMessage ?? null;
    const rawHash = patch.rawHash ?? null;
    const updateResult = await db.execute(sql`
      UPDATE scrape_runs SET
        status = ${status},
        events_found = ${eventsFound},
        error_message = ${errorMessage},
        raw_hash = ${rawHash},
        finished_at = ${finishedAt}
      WHERE id = ${run.id}
      RETURNING id, venue_id, started_at, finished_at, status, events_found, error_message, raw_hash
    `);
    const rows = unwrapRows<RawScrapeRunRow>(updateResult);
    if (!rows[0]) {
      console.warn(`[scraper] scrape_runs row ${run.id} not updated`);
      return toScrapeRun({ ...run, status, eventsFound, errorMessage, rawHash, finishedAt } as typeof schema.scrapeRuns.$inferSelect);
    }
    return rawToScrapeRun(rows[0]);
  };

  try {
    const html = opts.htmlOverride ?? (await fetchVenueHTML(venue.url, { fetcher: opts.fetcher }));
    const rawHash = sha256(html);

    if (!opts.force) {
      const prev = await db
        .select()
        .from(schema.scrapeRuns)
        .where(and(eq(schema.scrapeRuns.venueId, venueId), eq(schema.scrapeRuns.status, 'success')))
        .orderBy(desc(schema.scrapeRuns.startedAt))
        .limit(1);
      if (prev[0]?.rawHash === rawHash) {
        return await finalize({ status: 'skipped_unchanged', rawHash });
      }
    }

    const venueForVenueOps: Venue = {
      id: venue.id,
      name: venue.name,
      url: venue.url,
      city: venue.city,
      country: venue.country,
      category: venue.category as Venue['category'],
      language: venue.language,
      timezone: venue.timezone,
      createdAt: (venue.createdAt instanceof Date ? venue.createdAt : new Date(venue.createdAt)).toISOString(),
    };

    const { cleaned, hint } = preprocessForVenue(html, venueForVenueOps);
    const today = opts.now ?? new Date();
    const raw = await extractEvents(cleaned, venueForVenueOps, today, {
      client: opts.extractor,
      hint,
    });
    const { valid, invalid } = validateEvents(raw);
    if (invalid.length) {
      console.warn(`[scraper] ${venue.name}: ${invalid.length} invalid entries skipped`,
        invalid.slice(0, 3).map((i) => i.error));
    }
    await saveEvents(venueForVenueOps, valid);

    return await finalize({
      status: 'success',
      eventsFound: valid.length,
      rawHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scraper] ${venue.name} failed:`, message);
    return await finalize({ status: 'failed', errorMessage: message });
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function toScrapeRun(row: typeof schema.scrapeRuns.$inferSelect): ScrapeRun {
  return {
    id: row.id,
    venueId: row.venueId,
    startedAt: toDate(row.startedAt).toISOString(),
    finishedAt: row.finishedAt ? toDate(row.finishedAt).toISOString() : null,
    status: row.status as ScrapeRun['status'],
    eventsFound: row.eventsFound,
    errorMessage: row.errorMessage,
    rawHash: row.rawHash,
  };
}

interface RawScrapeRunRow {
  id: string;
  venue_id: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  status: string;
  events_found: number | null;
  error_message: string | null;
  raw_hash: string | null;
}

function rawToScrapeRun(row: RawScrapeRunRow): ScrapeRun {
  return {
    id: row.id,
    venueId: row.venue_id,
    startedAt: toDate(row.started_at).toISOString(),
    finishedAt: row.finished_at ? toDate(row.finished_at).toISOString() : null,
    status: row.status as ScrapeRun['status'],
    eventsFound: row.events_found,
    errorMessage: row.error_message,
    rawHash: row.raw_hash,
  };
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function unwrapRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const r = (result as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as T[];
  }
  return [];
}

