import { createHash } from 'node:crypto';
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { env } from '../../config.js';
import { fetchVenueHTML } from './fetcher.js';
import { preprocessForVenue, isDeterministicallyParsable } from './preprocessor.js';
import { parseJsonLdEvents } from './jsonld.js';
import { extractEvents, EXTRACTOR_VERSION, modelFor, windowDaysForCategory, type ExtractorClient } from './extractor.js';
import { getDeterministicScraper } from './deterministic.js';
import { defaultUserVenueStore } from '../user-venue-store.js';
import { validateEvents } from './validator.js';
import { toStartsAt } from './venues/datetime.js';
import { enrichDescriptions, type DescriptionClient } from './enricher.js';
import { defaultDescriber } from './describer.js';
import { defaultEventStore } from '../event-store.js';
import { saveEvents, pruneStaleEvents } from './persister.js';
import type { Venue, ScrapeRun } from '@afisz/shared';

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
  /** Description extractor for detail-page enrichment (GOI-79). Injected in
   *  tests; defaults to the Anthropic one when a key is configured. */
  describer?: DescriptionClient;
  /** Override the per-run detail-fetch cap. */
  maxDetailFetches?: number;
  /** Override the pause between detail fetches (tests use 0). */
  enrichDelayMs?: number;
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

  // Enrichment cost for this run (GOI-79). Declared out here so `finalize`
  // records whatever was spent even on a path that later throws — the money
  // is gone either way, and a run that fails after enriching is exactly when
  // you want the number.
  let detailFetches = 0;
  let detailInputTokens = 0;
  let detailOutputTokens = 0;

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
        detail_fetches = ${detailFetches},
        detail_input_tokens = ${detailInputTokens},
        detail_output_tokens = ${detailOutputTokens},
        finished_at = ${finishedAt}::timestamptz
      WHERE id = ${run.id}::uuid
    `);
    const selectResult = await db.execute(sql`
      SELECT id, venue_id, started_at, finished_at, status, events_found, error_message, raw_hash,
             detail_fetches, detail_input_tokens, detail_output_tokens
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
      ? { apiKey: env.FIRECRAWL_API_KEY, apiUrl: env.FIRECRAWL_API_URL, waitMs: env.FIRECRAWL_WAIT_MS }
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

    // Deterministic venues (e.g. Kinoteka, Komediowy) carry machine-readable
    // showtimes in the markup, so we parse with cheerio instead of the LLM —
    // cheaper, exact, and able to fan out across a multi-day/multi-month
    // window.
    const deterministic = getDeterministicScraper(venue.id, venue.url);
    let raw: unknown[];
    let rawHash: string;
    /**
     * The last day this run may be trusted for, when a multi-page scraper got
     * less than it asked for. Null means the whole window (GOI-107).
     */
    let coveredThrough: string | null = null;

    // Effective scrape horizon: users can widen it per subscription (a venue
    // shared by many users is scraped once, at the widest window anyone
    // asked for), never below the category default. Store errors degrade to
    // the default rather than failing the scrape.
    const userMaxWindow = await defaultUserVenueStore.maxWindowDays(venue.id).catch(() => null);
    const effectiveWindowDays = Math.max(windowDaysForCategory(venue.category), userMaxWindow ?? 0);

    if (deterministic) {
      if (opts.htmlOverride) {
        raw = deterministic.parse(opts.htmlOverride, venue.timezone);
        rawHash = sha256(`v${EXTRACTOR_VERSION}\n${opts.htmlOverride}`);
      } else {
        const res = await deterministic.scrape({
          baseUrl: fetchUrl,
          today,
          windowDays: effectiveWindowDays,
          timezone: venue.timezone,
          fetcher: opts.fetcher,
        });
        raw = res.events;
        rawHash = sha256(`v${EXTRACTOR_VERSION}\n${res.signature}`);
        coveredThrough = res.coveredThrough ?? null;
      }
      if (await isUnchanged(rawHash)) {
        return await finalize({ status: 'skipped_unchanged', rawHash });
      }
    } else {
      const html =
        opts.htmlOverride ?? (await fetchVenueHTML(fetchUrl, { fetcher: opts.fetcher, firecrawl }));
      // Fingerprint the *cleaned* content (what we'd actually send to the model),
      // not the raw HTML. Raw pages carry per-request noise — rotating CSRF
      // tokens, ad slots, "N people viewing" counters, build ids — that flips a
      // raw-HTML hash daily even when the event listing is unchanged, forcing a
      // full (paid) re-extract every sweep. Preprocessing strips that noise, so
      // hashing `cleaned` means we skip (for $0) whenever the listing itself
      // hasn't moved. Cost of preprocessing first is negligible (local cheerio).
      const { cleaned, hint, structured } = preprocessForVenue(html, venueForVenueOps);
      rawHash = sha256(`v${EXTRACTOR_VERSION}\n${cleaned}`);
      if (await isUnchanged(rawHash)) {
        return await finalize({ status: 'skipped_unchanged', rawHash });
      }
      // When the page's JSON-LD is rich enough that `cleaned` is the structured
      // payload alone, an LLM call would only transcribe JSON to JSON — the
      // model sees nothing our mapper doesn't. Extract in code instead ($0),
      // falling back to the LLM if the mapping yields nothing usable (e.g.
      // dates buried in free text that only the model can read).
      let jsonLdRows: unknown[] | null = null;
      if (isDeterministicallyParsable(structured)) {
        const rows = parseJsonLdEvents(structured.nodes, {
          pageUrl: fetchUrl,
          today,
          windowDays: effectiveWindowDays,
        });
        if (rows.length > 0) {
          console.log(`[scraper] ${venue.name}: ${rows.length} event(s) from JSON-LD (deterministic, no LLM call)`);
          jsonLdRows = rows;
        }
      }
      raw =
        jsonLdRows ??
        (await extractEvents(cleaned, venueForVenueOps, today, {
          client: opts.extractor,
          hint,
          windowDays: effectiveWindowDays,
          // A page whose body the preprocessor replaced with its JSON-LD /
          // __NEXT_DATA__ payload is transcription, not interpretation, and
          // may not need Sonnet (GOI-16). No-op unless
          // EXTRACTOR_MODEL_STRUCTURED is set.
          model: modelFor(isDeterministicallyParsable(structured)),
        }));
    }
    const { valid, invalid } = validateEvents(raw, {
      category: venue.category,
      timezone: venue.timezone,
    });
    if (invalid.length) {
      // Log the row, not just the complaint (GOI-67). "an exhibition must
      // carry ends_at" on its own says nothing about *which* listing lost its
      // closing date, so a venue quietly shedding rows was undiagnosable
      // without re-running the scrape by hand.
      console.warn(`[scraper] ${venue.name}: ${invalid.length} invalid entries skipped`,
        invalid.slice(0, 3).map((i) => ({ error: i.error, entry: describeEntry(i.entry) })));
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
    // the scrape — title + time are still saved. Deterministic venues skip
    // this by default (descriptions come inline) unless they opt in because
    // their descriptions live on per-event pages (e.g. Komediowy).
    if (!deterministic || deterministic.enrich) {
      const enrich = await enrichDescriptions(valid, {
        venueUrl: fetchUrl,
        fetcher: opts.fetcher,
        delayMs: opts.enrichDelayMs,
        maxFetches: opts.maxDetailFetches ?? env.MAX_DETAIL_FETCHES,
        client: opts.describer ?? defaultDescriber() ?? undefined,
        // Only pages we've never described get fetched (GOI-79); the rest are
        // filled from what that fetch already bought us (GOI-90). Scoped to
        // this venue.
        storedDetails: (urls) => defaultEventStore.storedDetails(venue.id, urls),
      });
      detailFetches = enrich.fetched;
      detailInputTokens = enrich.inputTokens;
      detailOutputTokens = enrich.outputTokens;
      if (enrich.enriched > 0 || enrich.backfilled > 0 || enrich.failed > 0 || enrich.capped > 0) {
        console.log(
          `[scraper] ${venue.name}: enriched ${enrich.enriched} description(s) from ` +
          `${enrich.fetched} detail page(s), ${enrich.backfilled} reused from store ` +
          `(${enrich.failed} failed, ${enrich.skipped} skipped, ` +
          `${enrich.capped} over cap; ${enrich.inputTokens}+${enrich.outputTokens} tokens)`,
        );
      }
    }
    await saveEvents(venueForVenueOps, valid);

    // The scrape is authoritative for its window: rows starting inside it that
    // this run didn't upsert are gone from the venue's listing (cancelled,
    // moved, or created by an older bad extraction) and would otherwise live
    // in the DB forever — upserts alone never delete. Only after a non-empty
    // save: an empty/partial-failure run must not wipe a venue.
    if (valid.length > 0) {
      const asked = new Date(today.getTime() + effectiveWindowDays * 86_400_000);
      /**
       * …for the window it actually *read*, which is not always the one it
       * asked for. A multi-page scraper that loses a page mid-walk returns
       * what it has; pruning the full window on the strength of that deletes
       * the days it never looked at — and cancels the saved ones, so readers
       * are told a film they bookmarked is off (GOI-107). Muranów's calendar
       * is one month per page and the cinema window is a week, so every scrape
       * within a few days of a month's end depends on a hop that can fail.
       */
      const windowEnd = clampToCovered(asked, coveredThrough, venue.timezone);
      if (windowEnd < asked) {
        console.warn(
          `[scraper] ${venue.name}: scrape only reached ${coveredThrough}; ` +
          'pruning that far and leaving the rest of the window alone',
        );
      }
      const pruned = await pruneStaleEvents(venue.id, {
        windowStart: today,
        windowEnd,
        olderThan: startedAt,
      });
      if (pruned > 0) {
        console.log(`[scraper] ${venue.name}: pruned ${pruned} stale event(s) no longer on the listing`);
      }
    }

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

/**
 * The end of the prune window: what was asked for, or how far the scrape got,
 * whichever is nearer (GOI-107).
 *
 * `coveredThrough` is an inclusive calendar day in the venue's own zone, so it
 * is taken to the last minute of that day — a run that read a whole month is
 * authoritative for that month's last evening, not for its midnight.
 */
export function clampToCovered(
  asked: Date,
  coveredThrough: string | null,
  timezone: string,
): Date {
  if (!coveredThrough) return asked;
  const end = toStartsAt(coveredThrough, '23:59', timezone);
  if (!end) return asked;
  const covered = new Date(end);
  return covered < asked ? covered : asked;
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
    .replace(/\{\{MM-YYYY\}\}/g, `${m}-${y}`)
    .replace(/\{\{YYYY\}\}/g, y)
    .replace(/\{\{MM\}\}/g, m);
}

/**
 * A rejected extractor row, trimmed to what identifies it in a log line
 * (GOI-67). The whole entry can carry a multi-paragraph description, which
 * would bury the sweep's output; title plus dates is enough to find the
 * listing on the venue's page.
 */
export function describeEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object') return entry;
  const e = entry as Record<string, unknown>;
  const keep = ['title', 'kind', 'starts_at', 'ends_at', 'source_url'] as const;
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in e) out[k] = e[k];
  return Object.keys(out).length > 0 ? out : entry;
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
  detail_fetches: number | string | null;
  detail_input_tokens: number | string | null;
  detail_output_tokens: number | string | null;
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
    detailFetches: toInt(row.detail_fetches),
    detailInputTokens: toInt(row.detail_input_tokens),
    detailOutputTokens: toInt(row.detail_output_tokens),
  };
}

/** postgres-js returns integers as strings on some paths. */
function toInt(v: number | string | null): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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

