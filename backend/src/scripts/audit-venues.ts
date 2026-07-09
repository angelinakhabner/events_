/**
 * TEMPORARY audit helper (runs from the venue-audit workflow, no DB needed).
 *
 * For every default venue it answers two questions side by side:
 *   1. What does the ORIGINAL site offer right now, and can our scraper see it?
 *      (probe-style fetch + structured-data / deterministic parse — no LLM)
 *   2. What is actually VISIBLE IN THE APP right now?
 *      (production tRPC API: events.listByVenue + the Home feed listDefault)
 *
 * Prints a JSON report between AUDIT_JSON markers so the caller can lift it
 * from the job log.
 */
import { DEFAULT_VENUES } from '../data/default-venues.js';
import { fetchVenueHTML } from '../services/scraper/fetcher.js';
import { preprocessForVenue, isDeterministicallyParsable } from '../services/scraper/preprocessor.js';
import { parseJsonLdEvents } from '../services/scraper/jsonld.js';
import { getDeterministicScraper } from '../services/scraper/deterministic.js';
import { windowDaysForCategory } from '../services/scraper/extractor.js';
import { resolveVenueUrl } from '../services/scraper/runner.js';
import { validateEvents } from '../services/scraper/validator.js';

const API = (process.env.AUDIT_API_URL ?? '').replace(/\/+$/, '');

interface SourceSide {
  fetchOk: boolean;
  httpError: string | null;
  htmlChars: number | null;
  cleanedChars: number | null;
  structuredSource: 'jsonld' | 'nextdata' | null;
  jsonLdEventNodes: number | null;
  /** Events extractable in code right now (JSON-LD or deterministic scraper),
   *  within the venue's category window. Null when only the LLM path applies. */
  deterministicEvents: number | null;
  deterministicValid: number | null;
  extractionMethod: 'deterministic-venue' | 'jsonld' | 'ai' | 'unscrapable';
  note: string | null;
}

interface AppSide {
  apiOk: boolean;
  visibleUpcoming: number | null;
  firstStartsAt: string | null;
  lastStartsAt: string | null;
  distinctDays: number | null;
  error: string | null;
}

async function auditSource(venue: (typeof DEFAULT_VENUES)[number], today: Date): Promise<SourceSide> {
  const windowDays = windowDaysForCategory(venue.category);
  const url = resolveVenueUrl(venue.url, today, venue.timezone);
  const out: SourceSide = {
    fetchOk: false, httpError: null, htmlChars: null, cleanedChars: null,
    structuredSource: null, jsonLdEventNodes: null,
    deterministicEvents: null, deterministicValid: null,
    extractionMethod: 'ai', note: null,
  };

  const det = getDeterministicScraper(venue.id);
  if (det) {
    out.extractionMethod = 'deterministic-venue';
    try {
      const res = await det.scrape({ baseUrl: url, today, windowDays, timezone: venue.timezone });
      out.fetchOk = true;
      out.deterministicEvents = res.events.length;
      const { valid } = validateEvents(res.events, { category: venue.category, timezone: venue.timezone });
      out.deterministicValid = valid.length;
    } catch (e) {
      out.httpError = e instanceof Error ? e.message : String(e);
    }
    return out;
  }

  let html: string;
  try {
    html = await fetchVenueHTML(url);
  } catch (e) {
    out.httpError = e instanceof Error ? e.message : String(e);
    out.extractionMethod = 'unscrapable';
    return out;
  }
  out.fetchOk = true;
  out.htmlChars = html.length;

  const { cleaned, structured } = preprocessForVenue(html, venue);
  out.cleanedChars = cleaned.trim().length;
  out.structuredSource = structured?.source ?? null;
  out.jsonLdEventNodes = structured?.source === 'jsonld' ? structured.eventCount : null;

  if (isDeterministicallyParsable(structured)) {
    const rows = parseJsonLdEvents(structured.nodes, { pageUrl: url, today, windowDays });
    if (rows.length > 0) {
      out.extractionMethod = 'jsonld';
      out.deterministicEvents = rows.length;
      const { valid } = validateEvents(rows, { category: venue.category, timezone: venue.timezone });
      out.deterministicValid = valid.length;
      return out;
    }
    out.note = 'JSON-LD present but 0 rows map into the window — would fall back to the LLM';
  }

  if (out.cleanedChars < 400) {
    out.extractionMethod = 'unscrapable';
    out.note = 'Page fetches but has almost no readable content (JS-rendered shell)';
  }
  return out;
}

interface ApiVenue {
  id: string;
  name: string;
  url: string;
}

/** The DB assigns venues generated UUIDs (seed upserts by URL), so the slug
 *  ids in default-venues.ts don't exist server-side. Map slug → UUID via the
 *  public venues.list endpoint, matching by URL first, then name. */
async function fetchApiVenues(): Promise<ApiVenue[]> {
  if (!API) return [];
  try {
    const res = await fetch(`${API}/trpc/venues.list`);
    if (!res.ok) return [];
    const json = (await res.json()) as { result?: { data?: ApiVenue[] } };
    return json.result?.data ?? [];
  } catch {
    return [];
  }
}

function resolveApiVenueId(venue: { name: string; url: string }, apiVenues: ApiVenue[]): string | null {
  const byUrl = apiVenues.find((v) => v.url === venue.url);
  if (byUrl) return byUrl.id;
  const byName = apiVenues.find((v) => v.name === venue.name);
  return byName?.id ?? null;
}

async function auditApp(venueId: string | null): Promise<AppSide> {
  if (!API) return { apiOk: false, visibleUpcoming: null, firstStartsAt: null, lastStartsAt: null, distinctDays: null, error: 'AUDIT_API_URL not set' };
  if (!venueId) return { apiOk: false, visibleUpcoming: null, firstStartsAt: null, lastStartsAt: null, distinctDays: null, error: 'venue not found in production venues.list' };
  try {
    const input = encodeURIComponent(JSON.stringify({ venueId }));
    const res = await fetch(`${API}/trpc/events.listByVenue?input=${input}`);
    if (!res.ok) return { apiOk: false, visibleUpcoming: null, firstStartsAt: null, lastStartsAt: null, distinctDays: null, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { result?: { data?: Array<{ startsAt: string }> } };
    const rows = json.result?.data ?? [];
    const days = new Set(rows.map((r) => r.startsAt.slice(0, 10)));
    return {
      apiOk: true,
      visibleUpcoming: rows.length,
      firstStartsAt: rows[0]?.startsAt ?? null,
      lastStartsAt: rows[rows.length - 1]?.startsAt ?? null,
      distinctDays: days.size,
      error: null,
    };
  } catch (e) {
    return { apiOk: false, visibleUpcoming: null, firstStartsAt: null, lastStartsAt: null, distinctDays: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function auditHomeFeed(): Promise<unknown> {
  if (!API) return { error: 'AUDIT_API_URL not set' };
  try {
    const res = await fetch(`${API}/trpc/events.listDefault`);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = (await res.json()) as { result?: { data?: Array<{ startsAt: string; venue?: { id?: string }; venueId?: string }> } };
    const rows = json.result?.data ?? [];
    const perVenue: Record<string, number> = {};
    for (const r of rows) {
      const id = r.venue?.id ?? r.venueId ?? 'unknown';
      perVenue[id] = (perVenue[id] ?? 0) + 1;
    }
    return {
      total: rows.length,
      firstStartsAt: rows[0]?.startsAt ?? null,
      lastStartsAt: rows[rows.length - 1]?.startsAt ?? null,
      perVenue,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  const today = new Date();
  const apiVenues = await fetchApiVenues();
  console.error(`[audit] resolved ${apiVenues.length} venues from production venues.list`);
  const report: unknown[] = [];
  for (const venue of DEFAULT_VENUES) {
    console.error(`[audit] ${venue.id} …`);
    const apiVenueId = resolveApiVenueId(venue, apiVenues);
    const [source, app] = await Promise.all([
      auditSource(venue, today).catch((e) => ({ crashed: String(e) })),
      auditApp(apiVenueId),
    ]);
    report.push({
      id: venue.id,
      apiVenueId,
      name: venue.name,
      url: venue.url,
      category: venue.category,
      windowDays: windowDaysForCategory(venue.category),
      source,
      app,
    });
  }
  const homeFeed = await auditHomeFeed();
  console.log('===AUDIT_JSON_START===');
  console.log(JSON.stringify({ generatedAt: today.toISOString(), apiUrl: API || null, homeFeed, venues: report }, null, 2));
  console.log('===AUDIT_JSON_END===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
