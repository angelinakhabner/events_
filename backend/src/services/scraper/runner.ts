import { createHash } from 'node:crypto';
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { env } from '../../config.js';
import { fetchVenueHTML } from './fetcher.js';
import { preprocessForVenue } from './preprocessor.js';
import { extractEvents, EXTRACTOR_VERSION, windowDaysForCategory, type ExtractorClient } from './extractor.js';
import { getDeterministicScraper } from './deterministic.js';
import { validateEvents } from './validator.js';
import { enrichDescriptions } from './enricher.js';
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
    // The UPDATE … RETURNING path was observed to flake in CI: the RETURNING
    // result occasionally came back empty even though the row genuinely
    // existed. Decouple the write from the read: explicit UPDATE, then a
    // separate SELECT for the canonical state. Cast id to ::uuid so postgres
    // doesn't have to infer the WHERE column type from a bound text param.
    // Pass the timestamp as an ISO string — postgres-js's prepared-statement
    // bind path doesn't accept raw Date objects inside drizzle's sql template
    // (it does inside typed .values({}) inserts).
    const finishedAt = new Date().toISOString();
    const status = patch.status ?? 'failed';
    const eventsFound = patch.eventsFound ?? null;
    const errorMessage = patch.errorMessage ?? null;
    const rawHash = patch.rawHash ?? null;

    await db.execute(sql`
      UPDATE scrape_runs SET
        status = ${status},
        events_found = ${eventsFound},
        error_message = ${errorMessage},
        raw_hash = ${rawHash},
        finished_at = ${finishedAt}::timestamptz
      WHERE id = ${run.id}::uuid
    `);
    const selectResult = await db.execute(sql`
      SELECT id, venue_id, started_at, finished_at, status, events_found, error_message, raw_hash
      FROM scrape_runs WHERE id = ${run.id}::uuid LIMIT 1
    `);
    const rows = unwrapRows<RawScrapeRunRow>(selectResult);
    if (rows[0]) return rawToScrapeRun(rows[0]);

    // Read-after-write returned nothing — the row was deleted or never
    // existed. Surface this loudly rather than synthesizing a fake success
    // row, which would mask DB inconsistency.
    throw new Error(`scrape_runs row ${run.id} missing after UPDATE (status=${status})`);
  };

  try {
    // Resolve {{YYYY-MM}} / {{YYYY-MM-DD}} placeholders against the scrape's
    // "now" so date-parameterised listing URLs (Powszechny's month, MSN's from=)
    // never go stale. No placeholder → returned unchanged.
    const today = opts.now ?? new Date();
    const fetchUrl = resolveVenueUrl(venue.url, today, venue.timezone);
    // Render the listing through Firecrawl when configured (JS + anti-bot),
    // with automatic native fallback. Enrichment intentionally stays native.
    const firecrawl = env.FIRECRAWL_API_KEY
      ? { apiKey: env.FIRECRAWL_API_KEY, apiUrl: env.FIRECRAWL_API_URL }
      : undefined;
    const venueForVenueOps: Venue = {
      id: venue.id,
      name: venue.name,
      url: fetchUrl,
      city: venue.city,
      country: venue.country,
      category: venue.category as Venue['category'],
      language: venue.language,
      timezone: venue.timezone,
      createdAt: (venue.createdAt instanceof Date ? venue.createdAt : new Date(venue.createdAt)).toISOString(),
    };

    // Treat a prior empty success as "already seen" too, so an unchanged page
    // that yields no events isn't re-processed daily. Shared by both paths.
    // The rawHash mixes in EXTRACTOR_VERSION so a prompt/schema change forces a
    // re-scrape of every venue even when the page bytes are identical.
    const isUnchanged = async (hash: string): Promise<boolean> => {
      if (opts.force) return false;
      const prev = await db
        .select()
        .from(schema.scrapeRuns)
        .where(and(
          eq(schema.scrapeRuns.venueId, venueId),
          inArray(schema.scrapeRuns.status, ['success', 'success_empty']),
        ))
        .orderBy(desc(schema.scrapeRuns.startedAt))
        .limit(1);
      return prev[0]?.rawHash === hash;
    };

    // Deterministic venues (e.g. Kinoteka) carry machine-readable showtimes in
    // the markup, so we parse with cheerio instead of the LLM — cheaper, exact,
    // and able to fan out across a multi-day window. Descriptions come inline,
    // so we skip the enrichment pass too.
    const deterministic = getDeterministicScraper(venue.id);
    let raw: unknown[];
    let rawHash: string;

    if (deterministic) {
      if (opts.htmlOverride) {
        raw = deterministic.parse(opts.htmlOverride, venue.timezone);
        rawHash = sha256(`v${EXTRACTOR_VERSION}\n${opts.htmlOverride}`);
      } else {
        const res = await deterministic.scrape({
          baseUrl: fetchUrl,
          today,
          windowDays: windowDaysForCategory(venue.category),
          timezone: venue.timezone,
          fetcher: opts.fetcher,
        });
        raw = res.events;
        rawHash = sha256(`v${EXTRACTOR_VERSION}\n${res.signature}`);
      }
      if (await isUnchanged(rawHash)) {
        return await finalize({ status: 'skipped_unchanged', rawHash });
      }
    } else {
      const html =
        opts.htmlOverride ?? (await fetchVenueHTML(fetchUrl, { fetcher: opts.fetcher, firecrawl }));
      rawHash = sha256(`v${EXTRACTOR_VERSION}\n${html}`);
      if (await isUnchanged(rawHash)) {
        return await finalize({ status: 'skipped_unchanged', rawHash });
      }
      const { cleaned, hint } = preprocessForVenue(html, venueForVenueOps);
      raw = await extractEvents(cleaned, venueForVenueOps, today, {
        client: opts.extractor,
        hint,
      });
    }
    const { valid, invalid } = validateEvents(raw, {
      category: venue.category,
      timezone: venue.timezone,
    });
    if (invalid.length) {
      console.warn(`[scraper] ${venue.name}: ${invalid.length} invalid entries skipped`,
        invalid.slice(0, 3).map((i) => i.error));
    }
    // Observability: count rows where Claude fell back to the venue's own
    // calendar URL instead of finding a per-event page. We still save them
    // (they're better than no link) but a high ratio means the prompt or
    // preprocessor needs another pass for that venue.
    const fallbackCount = countCalendarFallbacks(valid, fetchUrl);
    if (fallbackCount > 0) {
      console.warn(`[scraper] ${venue.name}: ${fallbackCount}/${valid.length} events used the venue calendar URL as source_url`);
    }
    // Enrich descriptions by fetching each per-event page. Grouped by URL so
    // 80 unique films at Muranów costs ~80 GETs, not ~150. Concurrency-limited
    // (3 parallel) so we stay polite to venue servers. Failures don't fail
    // the scrape — title + time are still saved. Skipped for deterministic
    // venues, which already carry descriptions inline.
    if (!deterministic) {
      const enrich = await enrichDescriptions(valid, {
        venueUrl: fetchUrl,
        fetcher: opts.fetcher,
      });
      if (enrich.enriched > 0 || enrich.failed > 0) {
        console.log(
          `[scraper] ${venue.name}: enriched ${enrich.enriched} description(s) (${enrich.failed} failed, ${enrich.skipped} skipped)`,
        );
      }
    }
    await saveEvents(venueForVenueOps, valid);

    // A scrape that yields zero usable events is almost never a real "nothing
    // is on" — it's a JS-rendered page, a blocked request, a selector drift, or
    // (as with the midnight guard) extracted rows we had to reject. Record it as
    // a distinct status so it's visible and doesn't masquerade as a healthy run.
    // Existing events are left untouched (saveEvents no-ops on empty input).
    if (valid.length === 0) {
      console.warn(
        `[scraper] ${venue.name}: 0 usable events from ${Array.isArray(raw) ? raw.length : 0} extracted ` +
        `(${invalid.length} rejected) — recording success_empty`,
      );
      return await finalize({ status: 'success_empty', eventsFound: 0, rawHash });
    }

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

/**
 * Substitute date placeholders in a venue URL against `today`, formatted in the
 * venue's timezone. Lets a source carry a date-parameterised listing URL that
 * never goes stale — `…?miesiac={{YYYY-MM}}`, `…?from={{YYYY-MM-DD}}`. Also
 * available to user-added sources. URLs with no placeholder are returned as-is.
 */
export function resolveVenueUrl(url: string, today: Date, timezone = 'Europe/Warsaw'): string {
  if (!url.includes('{{')) return url;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const [y, m, d] = [part('year'), part('month'), part('day')];
  return url
    .replace(/\{\{YYYY-MM-DD\}\}/g, `${y}-${m}-${d}`)
    .replace(/\{\{YYYY-MM\}\}/g, `${y}-${m}`)
    .replace(/\{\{YYYY\}\}/g, y);
}

/**
 * How many extracted events used the venue's own calendar URL as their
 * source_url? Matches with a small bit of normalisation so trailing slashes
 * and case don't trick us. The field is the validator-emitted `source_url`
 * (snake_case) so callers can pass valid entries straight through.
 */
export function countCalendarFallbacks(
  events: Array<{ source_url: string }>,
  venueUrl: string,
): number {
  const target = normaliseUrl(venueUrl);
  return events.filter((e) => normaliseUrl(e.source_url) === target).length;
}

function normaliseUrl(u: string): string {
  return u.trim().toLowerCase().replace(/\/+$/, '');
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

