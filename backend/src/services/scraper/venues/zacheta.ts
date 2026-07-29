import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

/**
 * Zachęta — National Gallery of Art (GOI-31).
 *
 * `/pl/kalendarz` is fully server-rendered and already separates the two kinds
 * of row the gallery publishes:
 *
 *   <li class="list-item is-event">                     ← a dated, timed event
 *     <a class="list-item-link" href="/pl/kalendarz/64-2">
 *     <div class="list-item-date"><span>29.07 (ŚR) 18:00</span></div>
 *     <div class="list-item-title">
 *       <div class="list-item-maintitle">…</div>
 *       <div class="list-item-subtitle">…</div>
 *     <div class="list-item-venue">… Zachęta – Narodowa Galeria Sztuki</div>
 *
 *   <li class="list-item is-exhibition is-hidden">      ← a run, not an event
 *     <div class="list-item-date"><span>01.05 – 20.09.2026</span></div>
 *
 * Only `is-event` rows are taken. Exhibitions carry a date *range* rather than
 * a start instant, so the validator would drop them anyway — and a months-long
 * run is not something to put in a "what's on tonight" list.
 *
 * The seeded venue URL was the English homepage, which carries no dated
 * listing at all; the calendar is where the real programme lives.
 */

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://zacheta.art.pl';

export interface ZachetaRawEvent {
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

/**
 * Polish weekday abbreviations as the calendar prints them, mapped to the JS
 * convention (0=Sun … 6=Sat). Used to *verify* the inferred year — see below.
 */
const WEEKDAY_ABBR: Record<string, number> = {
  ND: 0, PN: 1, WT: 2, 'ŚR': 3, CZW: 4, PT: 5, SOB: 6,
};

/** `29.07 (ŚR) 18:00` → its parts, or null when the row isn't an event. */
export function parseEventDate(
  text: string,
): { day: number; month: number; weekday: number | null; hour: string } | null {
  const m = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})\s*\(([^)]+)\)\s*(\d{1,2}:\d{2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const abbr = m[3]!.replace(/\s+/g, '').toUpperCase();
  return { day, month, weekday: WEEKDAY_ABBR[abbr] ?? null, hour: m[4]! };
}

/**
 * Resolve `DD.MM` to a full ISO day.
 *
 * The calendar prints no year. Roll forward from `todayYmd` the way Filharmonia
 * does — a month already behind today means next year, since the page only
 * lists upcoming dates — then **check the guess against the weekday the row
 * itself prints** and correct it if they disagree.
 *
 * The roll-forward rule can only be wrong at a year boundary, which is exactly
 * where the weekday disambiguates, so the year stops being a heuristic.
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

  // A week of slack, so a listing that still shows yesterday isn't thrown a
  // year forward.
  const weekBefore = new Date(`${todayYmd}T00:00:00Z`);
  weekBefore.setUTCDate(weekBefore.getUTCDate() - 7);
  const floor = weekBefore.toISOString().slice(0, 10);

  const rolled = `${baseYear}-${mm}-${dd}` >= floor ? baseYear : baseYear + 1;

  const candidates = weekday === null
    ? [rolled]
    // Only the neighbouring years are plausible; the weekday picks between them.
    : [rolled, rolled - 1, rolled + 1];

  for (const year of candidates) {
    const iso = `${year}-${mm}-${dd}`;
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    // Reject an impossible date (31.02 rolls over into March in JS).
    if (d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) continue;
    if (weekday === null || d.getUTCDay() === weekday) return iso;
  }
  return null;
}

/** Parse the calendar page into raw event rows (validator-shaped). */
export function parseZachetaCalendar(
  html: string,
  todayYmd: string,
  timeZone: string = TZ_DEFAULT,
): ZachetaRawEvent[] {
  const $ = cheerio.load(html);
  const events: ZachetaRawEvent[] = [];

  $('li.list-item.is-event').each((_, el) => {
    const $item = $(el);
    const parsed = parseEventDate($item.find('.list-item-date').first().text());
    if (!parsed) return;

    const day = inferIsoDay(parsed.day, parsed.month, parsed.weekday, todayYmd);
    if (!day) return;
    const starts_at = toStartsAt(day, parsed.hour, timeZone);
    if (!starts_at) return;

    const main = clean($item.find('.list-item-maintitle').first().text());
    const subtitle = clean($item.find('.list-item-subtitle').first().text());
    // The gallery sometimes splits one sentence across main/subtitle, so the
    // subtitle is kept as description rather than being glued onto the title.
    const title = main || subtitle;
    if (!title) return;

    const href = $item.find('a.list-item-link').first().attr('href')?.trim();
    // `.phone-hide` holds the full venue name; `.short` is its mobile
    // abbreviation, and taking the element's whole text would concatenate both.
    const venue = clean($item.find('.list-item-venue .phone-hide').first().text());
    const description =
      [subtitle && subtitle !== title ? subtitle : '', venue && `Miejsce: ${venue}`]
        .filter(Boolean)
        .join(' — ') || null;

    events.push({
      title,
      starts_at,
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description,
      price_min: null,
      price_max: null,
      source_url: href ? new URL(href, ORIGIN).toString() : `${ORIGIN}/pl/kalendarz`,
      // "/pl/kalendarz/64-2" → "64-2", unique per occurrence.
      source_id: href?.match(/\/kalendarz\/([\w-]+)$/)?.[1] ?? null,
    });
  });

  return dedupe(events);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: ZachetaRawEvent[]): ZachetaRawEvent[] {
  const seen = new Set<string>();
  const out: ZachetaRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export interface ZachetaScrapeResult {
  events: ZachetaRawEvent[];
  signature: string;
}

/**
 * One GET. The calendar renders its whole forward programme in a single
 * response — 184 rows across ~27 days in the captured fixture — so there is no
 * pagination to follow. Rows outside [today, today+windowDays] are dropped so
 * a wide calendar can't smuggle in events the runner's stale-prune would then
 * read as missing.
 */
export async function scrapeZacheta(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<ZachetaScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const html = await fetchVenueHTML(calendarUrl(args.baseUrl), { fetcher: args.fetcher });
  const rows = parseZachetaCalendar(html, startDay, tz);
  const events = rows.filter((e) => {
    const day = e.starts_at.slice(0, 10);
    return day >= startDay && day <= endDay;
  });

  return { events, signature: html };
}

/**
 * The seeded venue URL may still be the homepage (`/en`), which has no dated
 * listing. Point any zacheta.art.pl URL at the calendar rather than failing.
 */
function calendarUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    if (/\/kalendarz/.test(u.pathname)) return u.toString();
    return new URL('/pl/kalendarz', u.origin).toString();
  } catch {
    return `${ORIGIN}/pl/kalendarz`;
  }
}
