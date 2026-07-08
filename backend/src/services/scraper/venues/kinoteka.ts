import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { clean } from '../enricher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Re-export the shared date/time helpers under their historical home — they
// started life here and the tests (and any future callers) import them from
// this module.
export { tzOffsetAt, toStartsAt } from './datetime.js';

// Kinoteka's /repertuar/ page is fully server-rendered: every screening is an
// <a> inside .e-movie__screenings carrying clean data-attributes —
//   data-day="2026-06-26"  data-hour="20:00"  data-eventid="…"
//   data-title="…"         data-description="…"
// and the film's own page is on a.e-movie__heading-link (…/film/<slug>/).
//
// That makes an LLM unnecessary (and avoids the misleading
// <time datetime="…T00:00:00+00:00"> on each card, which an LLM tends to read
// as a midnight/UTC start and shift every showtime). We parse the attributes
// directly. A single fetch only returns the *active* day, so the listing also
// exposes a day-picker of ?date=YYYY-MM-DD links — we follow those to cover the
// whole scrape window.

const TZ_DEFAULT = 'Europe/Warsaw';

export interface KinotekaRawEvent {
  title: string;
  starts_at: string;
  duration_minutes: number | null;
  language: string | null;
  director: string | null;
  cast: string[] | null;
  description: string | null;
  price_min: number | null;
  price_max: number | null;
  source_url: string;
  source_id: string | null;
}

export interface KinotekaScrapeResult {
  events: KinotekaRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** Parse one day's listing HTML into raw event rows (validator-shaped). */
export function parseKinotekaListing(html: string, timeZone: string = TZ_DEFAULT): KinotekaRawEvent[] {
  const $ = cheerio.load(html);
  const events: KinotekaRawEvent[] = [];

  $('article.e-movie').each((_, el) => {
    const $movie = $(el);
    const filmUrl =
      $movie.find('a.e-movie__heading-link').attr('href')?.trim() ||
      $movie.find('a.e-movie__thumbnail-link').attr('href')?.trim() ||
      null;
    const headingTitle = $movie.find('.e-movie__heading-link').first().text().trim();

    $movie.find('.e-movie__screenings a[data-day]').each((__, s) => {
      const $s = $(s);
      const day = $s.attr('data-day')?.trim() ?? '';
      const hour = $s.attr('data-hour')?.trim() ?? '';
      const starts_at = toStartsAt(day, hour, timeZone);
      if (!starts_at) return;
      const title = ($s.attr('data-title')?.trim() || headingTitle).trim();
      if (!title) return;
      const rawDesc = $s.attr('data-description')?.trim() || null;
      const eventId = $s.attr('data-eventid')?.trim() || null;

      events.push({
        title,
        starts_at,
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: rawDesc ? clean(rawDesc) : null,
        price_min: null,
        price_max: null,
        source_url: filmUrl || 'https://kinoteka.pl/repertuar/',
        source_id: eventId,
      });
    });
  });

  return events;
}

/** The day-picker's active date (the day the base page is showing), if present. */
export function extractActiveDate(html: string): string | null {
  const $ = cheerio.load(html);
  const href =
    $('.m-repertoire-table__item.is-active .m-repertoire-table__item-link').attr('href') ||
    $('.m-repertoire-table__item.is-active a').attr('href') ||
    '';
  return href.match(/date=(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/**
 * Dates (YYYY-MM-DD) offered by the day-picker that fall within
 * [today, today + windowDays] in `timeZone`. The picker skips days the cinema
 * is closed, so we only ever request days that actually exist.
 */
export function pickDatesWithinWindow(
  html: string,
  today: Date,
  windowDays: number,
  timeZone: string,
): string[] {
  const $ = cheerio.load(html);
  const startStr = ymdInTz(today, timeZone);
  const endStr = ymdInTz(new Date(today.getTime() + windowDays * 86_400_000), timeZone);
  const dates = new Set<string>();
  $('.m-repertoire-table__item-link').each((_, a) => {
    const d = ($(a).attr('href') ?? '').match(/[?&]date=(\d{4}-\d{2}-\d{2})/)?.[1];
    if (d && d >= startStr && d <= endStr) dates.add(d); // YYYY-MM-DD sorts lexically
  });
  return [...dates].sort();
}

function dedupeEvents(events: KinotekaRawEvent[]): KinotekaRawEvent[] {
  const seen = new Set<string>();
  const out: KinotekaRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}|${e.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Fetch the listing across the whole scrape window and parse every screening.
 * Follows the day-picker's ?date= links (one HTTP GET each, no LLM tokens),
 * reusing the base page for its active day. Resilient: a failed day is logged
 * and skipped rather than failing the venue.
 */
export async function scrapeKinoteka(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<KinotekaScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const baseHtml = await fetchVenueHTML(args.baseUrl, { fetcher: args.fetcher });

  const activeDate = extractActiveDate(baseHtml);
  const targetDates = pickDatesWithinWindow(baseHtml, args.today, args.windowDays, tz);

  const htmlByDate = new Map<string, string>();
  if (activeDate) htmlByDate.set(activeDate, baseHtml);

  for (const d of targetDates) {
    if (htmlByDate.has(d)) continue; // already have the active day
    const url = new URL(`?date=${d}`, args.baseUrl).toString();
    try {
      htmlByDate.set(d, await fetchVenueHTML(url, { fetcher: args.fetcher }));
    } catch (e) {
      console.warn(`[kinoteka] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Day-picker parse failed entirely → at least scrape the base page.
  if (htmlByDate.size === 0) htmlByDate.set(activeDate ?? 'base', baseHtml);

  const dates = [...htmlByDate.keys()].sort();
  const events = dedupeEvents(dates.flatMap((d) => parseKinotekaListing(htmlByDate.get(d)!, tz)));
  const signature = dates.map((d) => `${d}\n${htmlByDate.get(d)}`).join('\n\n');
  return { events, signature };
}
