import * as cheerio from 'cheerio';
import { fetchVenueHTML } from './fetcher.js';

export interface EnrichableEvent {
  source_url: string;
  description: string | null;
}

export interface EnrichOptions {
  /** Venue's calendar URL — events that point here have no per-event page,
   *  so there's no description to fetch. We skip them silently. */
  venueUrl: string;
  fetcher?: typeof fetch;
  concurrency?: number;
  timeoutMs?: number;
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  failed: number;
}

/**
 * Fills missing `description` fields by fetching each event's source_url and
 * extracting the OpenGraph / meta description / first content paragraph.
 * Mutates the events array in place. Failures are silent (description stays
 * null) so an enrichment problem never blocks the scrape from saving titles.
 *
 * Conservative on cost: we group events by source_url so one fetch fills
 * every screening of the same film/performance/exhibition.
 */
export async function enrichDescriptions(
  events: EnrichableEvent[],
  opts: EnrichOptions,
): Promise<EnrichResult> {
  const { venueUrl, fetcher, concurrency = 3, timeoutMs = 8_000 } = opts;
  const venueTarget = normUrl(venueUrl);

  const needs = new Map<string, EnrichableEvent[]>();
  let skipped = 0;
  for (const e of events) {
    if (e.description && e.description.trim().length > 0) { skipped++; continue; }
    if (!e.source_url || normUrl(e.source_url) === venueTarget) { skipped++; continue; }
    const list = needs.get(e.source_url) ?? [];
    list.push(e);
    needs.set(e.source_url, list);
  }

  const urls = [...needs.keys()];
  const cache = new Map<string, string | null>();
  let enriched = 0;
  let failed = 0;

  // Tiny worker-pool: max `concurrency` parallel fetches at a time. Polite
  // to venue servers and keeps memory bounded.
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, urls.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < urls.length) {
      const idx = cursor++;
      const url = urls[idx];
      if (!url) continue;
      try {
        const html = await fetchVenueHTML(url, { fetcher, timeoutMs });
        cache.set(url, extractDescription(html));
      } catch {
        cache.set(url, null);
        failed++;
      }
    }
  });
  await Promise.all(workers);

  for (const [url, list] of needs) {
    const desc = cache.get(url);
    if (!desc) continue;
    for (const e of list) e.description = desc;
    enriched += list.length;
  }

  return { enriched, skipped, failed };
}

/** Pulls the best one-liner-ish description out of a page's HTML. */
export function extractDescription(html: string): string | null {
  const $ = cheerio.load(html);

  const og = $('meta[property="og:description"]').attr('content');
  if (og && og.trim()) return clean(og);

  const meta = $('meta[name="description"]').attr('content');
  if (meta && meta.trim()) return clean(meta);

  // Prefer paragraphs inside the main content area; many CMS templates wrap
  // the description in a node body / field-content / article block.
  for (const sel of ['article p', 'main p', '.node__content p', '.field-content p', 'p']) {
    const text = $(sel).first().text().trim();
    if (text.length >= 40) return clean(text);
  }

  return null;
}

/** Collapse whitespace and cap length so it fits ~2 lines on mobile. */
export function clean(s: string): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 200) return collapsed;
  const cut = collapsed.slice(0, 200);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd > 100) return cut.slice(0, sentenceEnd + 1);
  const wordEnd = cut.lastIndexOf(' ');
  return wordEnd > 100 ? cut.slice(0, wordEnd) + '…' : cut + '…';
}

function normUrl(u: string): string {
  return u.trim().toLowerCase().replace(/\/+$/, '');
}
