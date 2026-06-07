import { createHash } from 'node:crypto';
import { eq, desc, and } from 'drizzle-orm';
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
    const [updated] = await db
      .update(schema.scrapeRuns)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(schema.scrapeRuns.id, run.id))
      .returning();
    return toScrapeRun(updated ?? run);
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
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status as ScrapeRun['status'],
    eventsFound: row.eventsFound,
    errorMessage: row.errorMessage,
    rawHash: row.rawHash,
  };
}

