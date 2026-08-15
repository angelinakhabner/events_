import * as cheerio from 'cheerio';
import { fetchVenueHTML } from './fetcher.js';

/**
 * Descriptions come from the *detail* page, not the listing (GOI-79).
 *
 * Museum and theatre listings were producing null descriptions across the
 * board, and it was never a broken selector: a calendar page carries a title,
 * a date, a time and a link, and that is all it carries. The description only
 * exists behind the link. So enrichment is a second pass that follows those
 * links — and because that means one HTTP request and one model call per
 * distinct show, nearly all of this file is about *not* doing them.
 *
 * Four things keep the bill down, in the order they bite:
 *   1. Rows already carrying a description are skipped outright.
 *   2. Rows whose detail URL is already in the DB *with* a description are
 *      dropped before any fetch — a weekly re-scrape of a monthly programme
 *      would otherwise re-extract every show, every time.
 *   3. Rows are grouped by URL, so a show playing twelve times costs one fetch.
 *   4. A hard per-run cap stops the whole pass.
 *
 * Fetches are sequential with a delay between them. That is deliberate and not
 * a performance oversight: these are small venue servers, and the previous
 * three-way worker pool was the sort of thing that gets a scraper blocked.
 */

export interface EnrichableEvent {
  source_url: string;
  description: string | null;
}

/** Extracts a description from a detail page's main text. Separate from the
 *  event extractor: different prompt, different output, and it needs token
 *  counts back for the run's cost record. */
export interface DescriptionClient {
  describe(args: { text: string; url: string }): Promise<DescriptionResult>;
}

export interface DescriptionResult {
  description: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface EnrichOptions {
  /** Venue's calendar URL. A row pointing here has no detail page of its own
   *  — Teatr Żydowski's listing is like this — so it keeps a null description
   *  and must not cause a fetch. */
  venueUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Pause between detail fetches. Sequential + spaced, never parallel. */
  delayMs?: number;
  /** Hard ceiling on detail fetches per run. Hitting it stops enrichment and
   *  leaves the rest null; it never fails the run. */
  maxFetches?: number;
  /**
   * Which of these detail URLs already have a stored description. Injected
   * rather than queried here so the enricher stays free of DB knowledge and
   * testable without one.
   */
  alreadyDescribed?: (urls: string[]) => Promise<Set<string>>;
  /** Absent → fall back to the page's own og:description/meta, no model call. */
  client?: DescriptionClient;
  /** Test seam for the inter-fetch delay. */
  sleep?: (ms: number) => Promise<void>;
}

export interface EnrichResult {
  /** Rows that ended up with a description. */
  enriched: number;
  /** Rows never considered: already described, or no detail page. */
  skipped: number;
  /** Detail pages that failed to fetch or extract. */
  failed: number;
  /** Detail pages actually fetched — the cost number. */
  fetched: number;
  /** URLs left unenriched because the cap was reached. */
  capped: number;
  inputTokens: number;
  outputTokens: number;
}

/** Default per-run ceiling on detail fetches (GOI-79 cost control). */
export const DEFAULT_MAX_DETAIL_FETCHES = 50;
const DEFAULT_DELAY_MS = 1_000;

export async function enrichDescriptions(
  events: EnrichableEvent[],
  opts: EnrichOptions,
): Promise<EnrichResult> {
  const {
    venueUrl,
    fetcher,
    timeoutMs = 8_000,
    delayMs = DEFAULT_DELAY_MS,
    maxFetches = DEFAULT_MAX_DETAIL_FETCHES,
    client,
    alreadyDescribed,
    sleep = defaultSleep,
  } = opts;

  const venueTarget = normUrl(venueUrl);
  const result: EnrichResult = {
    enriched: 0, skipped: 0, failed: 0, fetched: 0, capped: 0,
    inputTokens: 0, outputTokens: 0,
  };

  // Group by detail URL. One entry per distinct page, however many showings
  // point at it.
  const needs = new Map<string, EnrichableEvent[]>();
  for (const e of events) {
    if (e.description && e.description.trim().length > 0) { result.skipped++; continue; }
    if (!e.source_url || normUrl(e.source_url) === venueTarget) { result.skipped++; continue; }
    const list = needs.get(e.source_url) ?? [];
    list.push(e);
    needs.set(e.source_url, list);
  }

  let urls = [...needs.keys()];

  // Only new events get fetched. This is the difference between a re-scrape
  // costing nothing and costing the whole programme again.
  if (alreadyDescribed && urls.length > 0) {
    try {
      const known = await alreadyDescribed(urls);
      const fresh = urls.filter((u) => !known.has(u));
      for (const u of urls) {
        if (known.has(u)) result.skipped += needs.get(u)?.length ?? 0;
      }
      urls = fresh;
    } catch (e) {
      // A lookup failure must not stop enrichment — worst case we re-fetch.
      console.warn('[enricher] existing-description lookup failed, enriching all:', message(e));
    }
  }

  const cache = new Map<string, string | null>();

  for (const [i, url] of urls.entries()) {
    if (result.fetched >= maxFetches) {
      result.capped = urls.length - i;
      console.warn(
        `[enricher] per-run detail-fetch cap (${maxFetches}) reached — ` +
        `${result.capped} page(s) left unenriched`,
      );
      break;
    }

    // Space the requests out. The delay goes *before* every fetch after the
    // first, so a single-page enrichment costs no extra wall time.
    if (i > 0) await sleep(delayMs);

    try {
      const html = await fetchVenueHTML(url, { fetcher, timeoutMs });
      result.fetched++;
      cache.set(url, await describe(html, url, client, result));
    } catch (e) {
      result.fetched++;
      result.failed++;
      cache.set(url, null);
      console.warn(`[enricher] ${url}: ${message(e)}`);
    }
  }

  for (const [url, list] of needs) {
    const desc = cache.get(url);
    if (!desc) continue;
    for (const e of list) e.description = desc;
    result.enriched += list.length;
  }

  return result;
}

/**
 * Strip the page to its main content, then ask the model for the description.
 *
 * Falls back to the page's own `og:description` / `meta[description]` when
 * there is no client, and also when the model returns nothing usable — those
 * tags are frequently right, and a free correct answer beats a paid one.
 */
async function describe(
  html: string,
  url: string,
  client: DescriptionClient | undefined,
  result: EnrichResult,
): Promise<string | null> {
  const meta = extractDescription(html);
  if (!client) return meta;

  const text = mainContentText(html);
  if (!text) return meta;

  try {
    const out = await client.describe({ text, url });
    result.inputTokens += out.inputTokens;
    result.outputTokens += out.outputTokens;
    return out.description ? clean(out.description) : meta;
  } catch (e) {
    result.failed++;
    console.warn(`[enricher] ${url}: description extraction failed: ${message(e)}`);
    return meta;
  }
}

/** How much page text the model is shown. A detail page's description is at
 *  the top; the rest is navigation, related shows and a footer. */
const MAX_CONTENT_CHARS = 6_000;

/**
 * The readable body of a detail page: chrome removed, main region preferred.
 * Sending the whole document would pay for a menu and a cookie banner on every
 * call.
 */
export function mainContentText(html: string): string | null {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, header, footer, aside, form').remove();

  for (const sel of ['article', 'main', '.node__content', '.field-content', '#content', 'body']) {
    const text = $(sel).first().text().replace(/\s+/g, ' ').trim();
    if (text.length >= 80) return text.slice(0, MAX_CONTENT_CHARS);
  }
  return null;
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
