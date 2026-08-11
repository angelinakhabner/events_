import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { POLISH_MONTHS, toStartsAt, ymdInTz } from './datetime.js';
import { scrapeEdito, type EditoRawEvent } from './edito.js';

/**
 * The "wystawy" (exhibitions) half of an edito museum site — GOI-57, extended
 * to Królikarnia by GOI-43.
 *
 * MNW and its branch museums all run the edito CMS, and all of them publish
 * exhibitions on a page that carries no dated rows at all — only the run
 * written out in Polish prose:
 *
 *   <div class="news">
 *     <h1 class="title"><a href="/wystawy/…,89.html">Plakat polski. Kolekcja</a></h1>
 *     <div class="desc">20 czerwca - 13 września 2026</div>
 *
 * That is why "/wystawy lists ongoing exhibitions without dates — the
 * validator drops every row" was true of every one of these museums, and why
 * they showed nothing.
 *
 * Each run is expanded to one all-day row per day it covers, clipped to the
 * scrape window. Per-day rows are how exhibitions already reach the app — the
 * edito calendar emits them that way and `dedupeAllDay` collapses the run back
 * into a single card (GOI-53). Emitting one row at the opening date instead
 * would read as "started in May", and a listing would drop it the next
 * morning; a museum you can walk into today has to appear under today.
 *
 * Local midnight is what makes a row all-day: the validator accepts it for the
 * exhibition category, and the frontend keys "all-day" off exactly that.
 */

const TZ_DEFAULT = 'Europe/Warsaw';

/** Where the runs live. "Obecne" is what's open now, "planowane" what's next;
 *  "minione" is deliberately absent — a finished exhibition is not a listing. */
export const EXHIBITION_PATHS = ['/wystawy/obecne.html', '/wystawy/planowane.html'];

/** A single exhibition and the days it runs, before expansion. */
export interface ExhibitionRun {
  title: string;
  /** Warsaw calendar days, inclusive. */
  start: string;
  end: string;
  description: string | null;
  sourceUrl: string;
  sourceId: string | null;
}

// ─── The run line ────────────────────────────────────────────────────────────

const MONTH_WORD = '[a-ząćęłńóśźż]+';
/** "20 czerwca", "20 czerwca 2026", "20" (month borrowed from the other end). */
const PART = new RegExp(`^(\\d{1,2})(?:\\s+(${MONTH_WORD}))?(?:\\s+(\\d{4}))?$`, 'i');
/** Hyphen, either dash, or the word "do" — the page uses all three over time. */
const SEPARATOR = /\s+(?:[-–—]|do)\s+/;

interface DatePart {
  day: number;
  month: number | null;
  year: number | null;
}

function parsePart(text: string): DatePart | null {
  const m = text.trim().match(PART);
  if (!m) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  const month = m[2] ? (POLISH_MONTHS[m[2].toLowerCase()] ?? null) : null;
  // A month word we don't recognise is a parse failure, not an absent month —
  // guessing the other end's month would silently invent a date.
  if (m[2] && month === null) return null;
  return { day, month, year: m[3] ? Number(m[3]) : null };
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** True when the parts name a day that actually exists (rejects 31 lutego). */
function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * "20 czerwca - 13 września 2026" → `{ start: '2026-06-20', end: '2026-09-13' }`.
 *
 * Handles every shape the page has produced: a year on the right only, a year
 * on both ends (`29 września 2026 - 10 stycznia 2027`, which crosses New Year),
 * a shared month (`1 - 13 września 2026`), "od … do …", and a single date.
 *
 * When the line names no year at all, `todayYmd` anchors it: the run is read
 * as the next one to end, so a page still showing "5 - 20 stycznia" in
 * December means next January rather than eleven months ago.
 */
export function parseExhibitionRun(
  text: string,
  todayYmd: string,
): { start: string; end: string } | null {
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(/^\s*od\s+/i, '')
    .replace(/\s*r\.?\s*$/i, '') // trailing "r." (roku)
    .trim();
  if (!clean) return null;

  const pieces = clean.split(SEPARATOR);
  if (pieces.length > 2) return null;

  const rawEnd = parsePart(pieces[pieces.length - 1]!);
  if (!rawEnd || rawEnd.month === null) return null;
  const rawStart = pieces.length === 2 ? parsePart(pieces[0]!) : rawEnd;
  if (!rawStart) return null;

  const todayYear = Number(todayYmd.slice(0, 4));
  const endYear = rawEnd.year ?? inferEndYear(rawEnd.month, rawEnd.day, todayYmd, todayYear);
  const startMonth = rawStart.month ?? rawEnd.month;
  let startYear = rawStart.year ?? endYear;

  if (!isRealDate(endYear, rawEnd.month, rawEnd.day)) return null;
  if (!isRealDate(startYear, startMonth, rawStart.day)) return null;

  const end = ymd(endYear, rawEnd.month, rawEnd.day);
  // A run whose start lands after its end only means the year was borrowed
  // across New Year — "20 grudnia - 10 stycznia 2027" starts in 2026.
  if (rawStart.year === null && ymd(startYear, startMonth, rawStart.day) > end) {
    startYear -= 1;
    if (!isRealDate(startYear, startMonth, rawStart.day)) return null;
  }
  const start = ymd(startYear, startMonth, rawStart.day);
  return start <= end ? { start, end } : null;
}

/** The year that makes an undated end the next one still ahead of `todayYmd`. */
function inferEndYear(month: number, day: number, todayYmd: string, todayYear: number): number {
  return ymd(todayYear, month, day) >= todayYmd ? todayYear : todayYear + 1;
}

// ─── The exhibitions page ────────────────────────────────────────────────────

/** Read one /wystawy page into its runs. `pageUrl` absolutizes the links. */
export function parseExhibitionsListing(
  html: string,
  pageUrl: string,
  todayYmd: string,
): ExhibitionRun[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const runs: ExhibitionRun[] = [];

  $('.module-exhibitions .news').each((_, el) => {
    const $item = $(el);
    const $link = $item.find('.title a').first();
    const title = ($link.attr('title') || $link.text()).replace(/\s+/g, ' ').trim();
    const href = $link.attr('href')?.trim();
    if (!title || !href) return;

    const run = parseExhibitionRun($item.find('.desc').first().text(), todayYmd);
    // No run means no dates, and a listing entry without dates is exactly what
    // GOI-43 found to be useless — skip rather than stamp it with today.
    if (!run) return;

    const abs = new URL(href, base);
    if (abs.hostname !== base.hostname) return; // a sibling museum's row

    runs.push({
      title,
      start: run.start,
      end: run.end,
      description: null,
      sourceUrl: abs.toString(),
      sourceId: href.match(/,(\d+)\.html/)?.[1] ?? null,
    });
  });

  return runs;
}

/**
 * A run → one all-day row per day, clipped to `[fromDay, toDay]`.
 *
 * `source_id` carries the day, so re-scraping updates each occurrence in place
 * instead of duplicating it — the same keying the edito calendar uses.
 */
export function expandRun(
  run: ExhibitionRun,
  fromDay: string,
  toDay: string,
  timeZone: string = TZ_DEFAULT,
  /** Namespaces the row key. Per venue, and never changed once a venue has
   *  been scraped — a new prefix re-inserts every row instead of updating it. */
  idPrefix = 'postermuseum',
): EditoRawEvent[] {
  const first = run.start > fromDay ? run.start : fromDay;
  const last = run.end < toDay ? run.end : toDay;
  if (first > last) return [];

  const out: EditoRawEvent[] = [];
  for (let day = first; day <= last; day = nextDay(day)) {
    const starts_at = toStartsAt(day, '0:00', timeZone);
    if (!starts_at) break;
    out.push({
      title: run.title,
      starts_at,
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: run.description,
      price_min: null,
      price_max: null,
      source_url: run.sourceUrl,
      source_id: run.sourceId ? `${idPrefix}:wystawa:${run.sourceId}:${day}` : null,
    });
  }
  return out;
}

/** Calendar-day step, so a DST boundary can't skip or repeat a day. */
function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}


// ─── The shared scrape ───────────────────────────────────────────────────────

/**
 * The edito calendar plus the exhibition pages, in one pass: timed events from
 * the month lists, all-day runs from /wystawy.
 *
 * An exhibition page that won't load is logged and skipped rather than failing
 * the venue — the same treatment `scrapeEdito` gives a sibling month. Losing
 * the exhibitions is bad; losing the whole museum because one of two extra
 * pages 500'd is worse.
 */
export async function scrapeEditoWithExhibitions(
  args: {
    baseUrl: string;
    today: Date;
    windowDays: number;
    timezone?: string;
    fetcher?: typeof fetch;
  },
  idPrefix: string,
): Promise<{ events: EditoRawEvent[]; signature: string }> {
  const tz = args.timezone || TZ_DEFAULT;
  const calendar = await scrapeEdito(args);

  const fromDay = ymdInTz(args.today, tz);
  const toDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  const origin = new URL(args.baseUrl).origin;

  const exhibitions: EditoRawEvent[] = [];
  const pages: string[] = [];
  for (const path of EXHIBITION_PATHS) {
    const url = `${origin}${path}`;
    try {
      const html = await fetchVenueHTML(url, { fetcher: args.fetcher });
      pages.push(`${url}\n${html}`);
      for (const run of parseExhibitionsListing(html, url, fromDay)) {
        exhibitions.push(...expandRun(run, fromDay, toDay, tz, idPrefix));
      }
    } catch (e) {
      console.warn(`[${idPrefix}] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    events: dedupe([...calendar.events, ...exhibitions]),
    signature: [calendar.signature, ...pages].join('\n\n'),
  };
}

/**
 * Read a single /wystawy page straight into rows (tests / admin htmlOverride),
 * over a 60-day horizon — the exhibition category's own scrape window.
 */
export function parseExhibitionsPage(
  html: string,
  pageUrl: string,
  idPrefix: string,
  timeZone: string = TZ_DEFAULT,
  today: Date = new Date(),
): EditoRawEvent[] {
  const todayYmd = ymdInTz(today, timeZone);
  const horizon = ymdInTz(new Date(today.getTime() + 60 * 86_400_000), timeZone);
  return parseExhibitionsListing(html, pageUrl, todayYmd).flatMap((r) =>
    expandRun(r, todayYmd, horizon, timeZone, idPrefix),
  );
}

/** True when this HTML is an exhibitions page rather than a month calendar. */
export function isExhibitionsPage(html: string): boolean {
  return /module-exhibitions/.test(html);
}

function dedupe(events: EditoRawEvent[]): EditoRawEvent[] {
  const seen = new Set<string>();
  const out: EditoRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
