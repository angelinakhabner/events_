import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// TR Warszawa's /kalendarz/YYYY/MM/?view=calendar month pages are
// server-rendered (the site's own calendar widget swaps them in via PJAX —
// the same full pages a plain GET returns). Every performance is a tile
// inside its day cell:
//
//   <td class='calendar-table__day has-event'>
//     <a href='…/kalendarz/2026/07/03/?view=calendar' class='calendar-table__day-link-anchor'>
//     <div class='calendar-table__day-events'>
//       <a href='…/program/only-love-can-break-your-heart/' class='calendar-table__event …'>
//         <span class='event__category'>Marszałkowska 8</span>       ← stage/venue
//         <span class='event__hour'>20:00-21:10</span>               ← start(-end)
//         <span class='event__title'>only Love can break your Heart</span>
//
// The day comes from the cell's own day link, the running time from the
// hour range. Parsing directly makes the LLM (and Firecrawl) unnecessary.
// NOTE: the theatre goes dark over the summer — an empty July/August is
// genuinely empty, not a scrape failure.
//
// November 2026 redesign (GOI-150): the month pages moved to
// /kalendarz/?view=calendar&trw_month=YYYY-MM — the old /kalendarz/YYYY/MM/
// paths now 404 — and the tiles were rebuilt. Each performance is now
//
//   <article class="trw-calendar-page-event">
//     <a class="trw-calendar-page-event__main" href="…/program/…/">
//       <span class="trw-calendar-page-event__place">Marszałkowska 8</span>
//       <span class="trw-calendar-page-event__category">Spektakl</span>
//       <time class="trw-calendar-page-event__time" datetime="2026-11-02T09:00">09:00-14:00</time>
//       <h3 class="trw-calendar-page-event__title">…</h3>
//
// with the local start in `datetime`, so the day no longer has to be read off
// a cell link. Both shapes are parsed: the old one still matches the pages the
// fixtures captured, and nothing is lost if the site rolls back.

const TZ_DEFAULT = 'Europe/Warsaw';
const MONTH_SEGMENT_RE = /\/kalendarz\/\d{4}\/\d{2}\//;
const TRW_MONTH_RE = /([?&]trw_month=)\d{4}-\d{2}/;

export interface TrWarszawaRawEvent {
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

export interface TrWarszawaScrapeResult {
  events: TrWarszawaRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** "20:00-21:10" / "20:00" → start hour + running time in minutes. */
export function parseHourRange(text: string): { start: string; durationMinutes: number | null } | null {
  const t = text.replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2}):(\d{2})(?:[-–](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const start = `${m[1]}:${m[2]}`;
  if (!m[3]) return { start, durationMinutes: null };
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  let endMin = Number(m[3]) * 60 + Number(m[4]);
  if (endMin <= startMin) endMin += 24 * 60; // past-midnight curtain call
  return { start, durationMinutes: endMin - startMin };
}

/** Parse one month page into raw event rows (validator-shaped). */
export function parseTrWarszawaListing(
  html: string,
  timeZone: string = TZ_DEFAULT,
): TrWarszawaRawEvent[] {
  const $ = cheerio.load(html);
  const events: TrWarszawaRawEvent[] = [];

  $('td.calendar-table__day').each((_, td) => {
    const $td = $(td);
    const dayHref = $td.find('a.calendar-table__day-link-anchor').attr('href') ?? '';
    const dm = dayHref.match(/\/kalendarz\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (!dm) return;
    const day = `${dm[1]}-${dm[2]}-${dm[3]}`;

    $td.find('a.calendar-table__event').each((__, a) => {
      const $ev = $(a);
      const title = clean($ev.find('.event__title').first().text());
      const hour = parseHourRange($ev.find('.event__hour').first().text());
      const href = $ev.attr('href')?.trim();
      if (!title || !hour || !href) return;
      const starts_at = toStartsAt(day, hour.start, timeZone);
      if (!starts_at) return;

      const place = clean($ev.find('.event__category').first().text());
      // Tooltip badges ("Premiera", accessibility notes) are worth surfacing.
      const badges = $ev
        .find('.event-info__name')
        .map((___, b) => clean($(b).text()))
        .get()
        .filter(Boolean);
      const description =
        [badges.join(', '), place && `Scena: ${place}`].filter(Boolean).join(' — ') || null;

      events.push({
        title,
        starts_at,
        duration_minutes: hour.durationMinutes,
        language: null,
        director: null,
        cast: null,
        description,
        price_min: null,
        price_max: null,
        source_url: new URL(href, 'https://trwarszawa.pl').toString(),
        // No per-performance id in the markup; the persister keys on
        // source_url + starts_at, which is unique per showing.
        source_id: null,
      });
    });
  });

  // The redesigned calendar (GOI-150).
  $('article.trw-calendar-page-event').each((_, el) => {
    const $ev = $(el);
    const title = clean($ev.find('.trw-calendar-page-event__title').first().text());
    const $time = $ev.find('time.trw-calendar-page-event__time').first();
    const dt = ($time.attr('datetime') ?? '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const href = $ev.find('a.trw-calendar-page-event__main').attr('href')?.trim();
    if (!title || !dt || !href) return;
    const starts_at = toStartsAt(dt[1]!, dt[2]!, timeZone);
    if (!starts_at) return;
    const hour = parseHourRange($time.text());

    const place = clean($ev.find('.trw-calendar-page-event__place').first().text());
    const category = clean($ev.find('.trw-calendar-page-event__category').first().text());
    const description =
      [category, place && `Scena: ${place}`].filter(Boolean).join(' — ') || null;

    events.push({
      title,
      starts_at,
      duration_minutes: hour?.durationMinutes ?? null,
      language: null,
      director: null,
      cast: null,
      description,
      price_min: null,
      price_max: null,
      source_url: new URL(href, 'https://trwarszawa.pl').toString(),
      source_id: null,
    });
  });

  return dedupe(events);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: TrWarszawaRawEvent[]): TrWarszawaRawEvent[] {
  const seen = new Set<string>();
  const out: TrWarszawaRawEvent[] = [];
  for (const e of events) {
    const key = `${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * The listing URL for one month ("YYYY-MM" input).
 *
 * Since the November 2026 redesign (GOI-150) a month is
 * `/kalendarz/?view=calendar&trw_month=YYYY-MM`. A URL in that shape has its
 * month swapped; one still in the old `/kalendarz/YYYY/MM/` shape — a venue
 * row the seed has not moved yet — is rewritten to the new one, since the old
 * paths 404. Null for any other URL.
 */
export function monthUrl(baseUrl: string, ym: string): string | null {
  const [y, m] = ym.split('-');
  if (!y || !m) return null;
  if (TRW_MONTH_RE.test(baseUrl)) return baseUrl.replace(TRW_MONTH_RE, `$1${y}-${m}`);
  if (MONTH_SEGMENT_RE.test(baseUrl)) {
    return `https://trwarszawa.pl/kalendarz/?view=calendar&trw_month=${y}-${m}`;
  }
  return null;
}

/** Inclusive list of YYYY-MM months from `from` through `to`. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [from];
  let cur = from;
  while (cur < to && out.length < 24) {
    const [y, m] = cur.split('-').map(Number);
    const t = y! * 12 + (m! - 1) + 1;
    cur = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    out.push(cur);
  }
  return out;
}

/**
 * Fetch the month pages covering [today, today+windowDays], parse every tile,
 * and keep in-window rows. A failed month is logged and skipped rather than
 * failing the venue.
 */
export async function scrapeTrWarszawa(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<TrWarszawaScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  const months = monthRange(startDay.slice(0, 7), endDay.slice(0, 7));

  const pages = new Map<string, string>(); // url → html
  for (const ym of months) {
    const url = monthUrl(args.baseUrl, ym) ?? (ym === months[0] ? args.baseUrl : null);
    if (!url || pages.has(url)) continue;
    try {
      pages.set(url, await fetchVenueHTML(url, { fetcher: args.fetcher }));
    } catch (e) {
      console.warn(`[trwarszawa] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const urls = [...pages.keys()].sort();
  const events = dedupe(
    urls
      .flatMap((u) => parseTrWarszawaListing(pages.get(u)!, tz))
      .filter((e) => {
        const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
        return day >= startDay && day <= endDay;
      }),
  );
  const signature = urls.map((u) => `${u}\n${pages.get(u)}`).join('\n\n');
  return { events, signature };
}
