import { env } from '../../config.js';
import { fetchVenueHTML } from './fetcher.js';
import { preprocessForVenue, isDeterministicallyParsable } from './preprocessor.js';
import { parseJsonLdEvents } from './jsonld.js';
import { resolveVenueUrl } from './runner.js';

/**
 * "Can we scrape this URL?" — the check behind the green mark in the
 * add-venue form. Fetches the page the same way a real scrape would
 * (browser-shaped headers, Firecrawl rendering when configured) and reports
 * how events would be extracted, without calling the LLM or writing anything.
 */
export interface ProbeResult {
  /** True when a scrape of this URL is expected to work. */
  ok: boolean;
  /** How events would be extracted: structured data parsed in code (exact,
   *  free) or the AI extractor reading the page text. Null when !ok. */
  method: 'structured-data' | 'ai' | null;
  /** Upcoming events detected right now — only for structured-data probes;
   *  the AI path can't count without an LLM call. */
  eventCount: number | null;
  /** Why the URL can't be scraped. Null when ok. */
  reason: string | null;
}

/** Below this much cleaned page text the AI extractor has nothing to read —
 *  almost always a page rendered entirely by client-side JavaScript. */
const MIN_CONTENT_CHARS = 400;

/** How far ahead to count structured-data events. Wide on purpose: the probe
 *  answers "is this scrapable", not "what's on this week". */
const PROBE_WINDOW_DAYS = 90;

export async function probeVenueUrl(
  url: string,
  opts: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<ProbeResult> {
  const now = opts.now ?? new Date();
  const fetchUrl = resolveVenueUrl(url, now);

  let html: string;
  try {
    const firecrawl = env.FIRECRAWL_API_KEY
      ? { apiKey: env.FIRECRAWL_API_KEY, apiUrl: env.FIRECRAWL_API_URL, waitMs: env.FIRECRAWL_WAIT_MS }
      : undefined;
    html = await fetchVenueHTML(fetchUrl, { fetcher: opts.fetcher, firecrawl });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, method: null, eventCount: null, reason: `Couldn't fetch the page: ${message}` };
  }

  const { cleaned, structured } = preprocessForVenue(html, { id: 'probe' });

  if (isDeterministicallyParsable(structured)) {
    const rows = parseJsonLdEvents(structured.nodes, {
      pageUrl: fetchUrl,
      today: now,
      windowDays: PROBE_WINDOW_DAYS,
    });
    if (rows.length > 0) {
      return { ok: true, method: 'structured-data', eventCount: rows.length, reason: null };
    }
  }

  if (cleaned.trim().length >= MIN_CONTENT_CHARS) {
    return { ok: true, method: 'ai', eventCount: null, reason: null };
  }

  return {
    ok: false,
    method: null,
    eventCount: null,
    reason:
      'The page loads but contains almost no readable content — it is probably ' +
      'rendered entirely by JavaScript, which the scraper cannot see.',
  };
}
