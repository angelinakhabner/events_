import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

/**
 * Muzeum Sztuki Nowoczesnej (MSN / artmuseum.pl) — GOI-31.
 *
 * `/en/program-1` is a Next.js App Router page, but the programme itself is
 * server-rendered: day headings followed by cards, in document order.
 *
 *   <h2 class="… allcaps h3 mb-2xs">Wednesday, <br/> 29 July</h2>
 *   <a class="shadow-hover …" href="/en/events/…">
 *     <p class="allcaps text-sm">Film</p>
 *     <p class="allcaps text-sm ml-auto">18:00</p>       ← a timed event
 *     <h3 …><span>TITLE</span></h3>
 *
 * The same markup also carries the standing exhibitions, whose meta cell is a
 * *range* (`20.03.2026–30.08.2026`) rather than a time. Those are skipped: a
 * range has no start instant, the validator would drop it, and a five-month
 * run doesn't belong in a "what's on" list. In the captured page that is 44 of
 * 67 cards.
 *
 * The seeded URL was the old site's `/en/program-1?from=…&type=all`. The query
 * string is gone in the rebuild — and was what made the page 404 on capture.
 */

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://artmuseum.pl';

export interface MsnRawEvent {
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

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** `Wednesday, 29 July` → its parts, or null when the heading isn't a day. */
export function parseDayHeading(
  text: string,
): { weekday: number; day: number; month: number } | null {
  const m = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^(\w+),\s*(\d{1,2})\s+(\w+)$/);
  if (!m) return null;
  const weekday = WEEKDAYS[m[1]!.toLowerCase()];
  const month = MONTHS[m[3]!.toLowerCase()];
  const day = Number(m[2]);
  if (weekday === undefined || month === undefined) return null;
  if (day < 1 || day > 31) return null;
  return { weekday, day, month };
}

/**
 * The card's meta cell, which is either a clock time or an exhibition run.
 * Returns the start time for a timed card, null for anything else.
 *
 * `11:00 - 20:00` is an opening-hours span — the start is what we list.
 */
export function parseCardTime(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  // A range of *dates* is an exhibition, never a time.
  if (/\d{1,2}\.\d{2}\.\d{4}/.test(t)) return null;
  const m = t.match(/^(\d{1,2}:\d{2})(?:\s*[-–]\s*\d{1,2}:\d{2})?$/);
  return m ? m[1]! : null;
}

/**
 * Resolve `29 July` + its weekday name to a full ISO day.
 *
 * The programme prints no year. Roll forward from `todayYmd`, then check the
 * guess against the weekday the heading itself names and correct it — the same
 * technique the Zachęta and Jassmine scrapers use, and for the same reason:
 * the roll-forward can only be wrong at a year boundary, which is exactly
 * where the weekday disambiguates.
 */
export function inferIsoDay(
  day: number,
  month: number,
  weekday: number | null,
  todayYmd: string,
): string | null {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const baseYear = Number(todayYmd.slice(0, 4));
  if (!Number.isFinite(baseYear)) return null;

  const weekBefore = new Date(`${todayYmd}T00:00:00Z`);
  weekBefore.setUTCDate(weekBefore.getUTCDate() - 7);
  const floor = weekBefore.toISOString().slice(0, 10);
  const rolled = `${baseYear}-${mm}-${dd}` >= floor ? baseYear : baseYear + 1;

  const candidates = weekday === null ? [rolled] : [rolled, rolled - 1, rolled + 1];
  for (const year of candidates) {
    const iso = `${year}-${mm}-${dd}`;
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) continue;
    if (weekday === null || d.getUTCDay() === weekday) return iso;
  }
  return null;
}

/** Parse the programme page into raw event rows (validator-shaped). */
export function parseMsnProgram(
  html: string,
  todayYmd: string,
  timeZone: string = TZ_DEFAULT,
): MsnRawEvent[] {
  const $ = cheerio.load(html);
  const events: MsnRawEvent[] = [];
  let currentDay: string | null = null;

  // Headings and cards are siblings in reading order, so one document-order
  // walk carries the day forward onto the cards beneath it. Selecting them
  // separately would lose that association entirely.
  $('h2, a.shadow-hover').each((_, el) => {
    const $el = $(el);
    if (el.tagName?.toLowerCase() === 'h2') {
      const parsed = parseDayHeading($el.text());
      // A non-day heading ("Current exhibitions") closes the previous day
      // rather than letting its cards inherit it.
      currentDay = parsed
        ? inferIsoDay(parsed.day, parsed.month, parsed.weekday, todayYmd)
        : null;
      return;
    }
    if (!currentDay) return;

    const $meta = $el.find('p.allcaps');
    const hour = parseCardTime($meta.last().text());
    if (!hour) return; // an exhibition run, or a card with no time

    const title = clean($el.find('h3').first().text());
    if (!title) return;
    const starts_at = toStartsAt(currentDay, hour, timeZone);
    if (!starts_at) return;

    const href = $el.attr('href')?.trim();
    // Only the cards that carry a label ("Film", "Szumin") have two cells; on
    // the rest the single cell *is* the time, and reading it as a category
    // would file every event under its own start hour.
    const category = $meta.length > 1 ? clean($meta.first().text()) : '';

    events.push({
      title,
      starts_at,
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: category || null,
      price_min: null,
      price_max: null,
      source_url: href ? new URL(href, ORIGIN).toString() : `${ORIGIN}/en/program-1`,
      // The trailing slug is stable per event; the same title can recur on
      // several days, so the day is mixed in to keep occurrences distinct.
      source_id: href ? `${href.split('/').filter(Boolean).pop()}@${currentDay}` : null,
    });
  });

  return dedupe(events);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: MsnRawEvent[]): MsnRawEvent[] {
  const seen = new Set<string>();
  const out: MsnRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export interface MsnScrapeResult {
  events: MsnRawEvent[];
  signature: string;
}

/**
 * One GET. The programme page renders its whole forward window server-side, so
 * there is no pagination to follow. Rows outside [today, today+windowDays] are
 * dropped so a wide page can't smuggle in events the runner's stale-prune
 * would then read as missing.
 */
export async function scrapeMsn(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<MsnScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const html = await fetchVenueHTML(programUrl(args.baseUrl), { fetcher: args.fetcher });
  const rows = parseMsnProgram(html, startDay, tz);
  const events = rows.filter((e) => {
    const day = e.starts_at.slice(0, 10);
    return day >= startDay && day <= endDay;
  });

  return { events, signature: html };
}

/**
 * Databases seeded before the rebuild still hold the old query-string URL
 * (`/en/program-1?from=…&type=all`), which now 404s. Normalise any
 * artmuseum.pl URL onto the current programme path.
 */
function programUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return new URL('/en/program-1', u.origin).toString();
  } catch {
    return `${ORIGIN}/en/program-1`;
  }
}
