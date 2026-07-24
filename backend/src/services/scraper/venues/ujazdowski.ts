import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, tzOffsetAt, ymdInTz } from './datetime.js';

// CSW Zamek Ujazdowski's /en/wydarzenia calendar loads its day panels from
// server-rendered fragments the page's own JS swaps in:
//
//   GET /en/wydarzenia/week.ajax?ut=<epoch seconds of the day at 00:00 Warsaw>
//
//   <div id="calendar-items">
//     <a href="/en/kino/repertuar/the-piano-accident" class="event-list-day-box …">
//       <div class="hours fs-16"> 20<i class="finterp">:</i>30 </div>
//       <div class="category fs-16 mb--3"> film </div>
//       <div class="title fs-30 …"><em>The Piano Accident</em></div>
//
// One tiny (~6 kB) fragment per day covers the whole window without the LLM
// or Firecrawl. The `finterp` <i> wrappers inject punctuation, so text
// normalisation has to tolerate "20 : 30".

const TZ_DEFAULT = 'Europe/Warsaw';

export interface UjazdowskiRawEvent {
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

export interface UjazdowskiScrapeResult {
  events: UjazdowskiRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** Epoch seconds of `ymd` at 00:00 in `timeZone` — the fragment's ut key. */
export function utForDay(ymd: string, timeZone: string = TZ_DEFAULT): number {
  const offset = tzOffsetAt(new Date(`${ymd}T00:00:00Z`), timeZone);
  return Math.floor(new Date(`${ymd}T00:00:00${offset}`).getTime() / 1000);
}

/** Parse one day fragment into raw event rows for that day (validator-shaped). */
export function parseUjazdowskiDay(
  html: string,
  day: string,
  pageOrigin: string,
  timeZone: string = TZ_DEFAULT,
): UjazdowskiRawEvent[] {
  const $ = cheerio.load(html);
  const events: UjazdowskiRawEvent[] = [];

  $('#calendar-items a.event-list-day-box, .calendar-week-children a.event-list-day-box').each((_, el) => {
    const $box = $(el);
    const href = $box.attr('href')?.trim();
    const title = clean($box.find('.title').first().text());
    const hourText = clean($box.find('.hours').first().text());
    const hour = hourText.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (!href || !title || !hour) return;
    const starts_at = toStartsAt(day, `${hour[1]}:${hour[2]}`, timeZone);
    if (!starts_at) return;

    const category = clean($box.find('.category').first().text());

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
      source_url: new URL(href, pageOrigin).toString(),
      // No id in the markup; the persister keys on source_url + starts_at.
      source_id: null,
    });
  });

  return events;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: UjazdowskiRawEvent[]): UjazdowskiRawEvent[] {
  const seen = new Set<string>();
  const out: UjazdowskiRawEvent[] = [];
  for (const e of events) {
    const key = `${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Fetch the day fragment for every day in [today, today+windowDays] and parse
 * each. Fragments are ~6 kB so even a 60-day window stays light; a failed day
 * is logged and skipped rather than failing the venue.
 */
export async function scrapeUjazdowski(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<UjazdowskiScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const base = new URL(args.baseUrl);
  // ".../en/wydarzenia" → ".../en/wydarzenia/week.ajax"; tolerate a trailing /.
  const fragmentBase = `${base.origin}${base.pathname.replace(/\/+$/, '')}/week.ajax`;

  const all: UjazdowskiRawEvent[] = [];
  const chunks: string[] = [];
  for (let i = 0; i <= args.windowDays; i++) {
    const day = ymdInTz(new Date(args.today.getTime() + i * 86_400_000), tz);
    const url = `${fragmentBase}?ut=${utForDay(day, tz)}`;
    try {
      const html = await fetchVenueHTML(url, { fetcher: args.fetcher });
      chunks.push(`${day}\n${html}`);
      all.push(...parseUjazdowskiDay(html, day, base.origin, tz));
    } catch (e) {
      console.warn(`[ujazdowski] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { events: dedupe(all), signature: chunks.join('\n\n') };
}
