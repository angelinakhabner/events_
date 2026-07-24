import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Nowy Teatr's /pl/kalendarz is a JS-driven calendar, but its filter form is
// progressively enhanced: a plain GET with the form's own params returns the
// agenda server-rendered —
//
//   GET /pl/kalendarz?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
//   <div class="calendar__row">
//     <h3><span>05</span><label>sobota</label></h3>          ← day of month
//     <div class="calendar__cell js-cal-cell">
//       <a href="/pl/kalendarz/kofman-podwojne-wiazanie" class="calendar__link"></a>
//       <div class="calendar__event">
//         <div class="calendar__time"><time datetime="19.00">19.00</time>…</div>
//         <h4> Kofman. Podwójne wiązanie </h4>
//         <h5> subtitle </h5>
//
// Rows carry only the day-of-month, so the scraper requests one calendar
// month per GET and stamps rows with that month. Cells without a <time> are
// festival banners/all-day teasers — the validator would reject their
// midnight placeholder for a theatre anyway, so they're skipped here.
// NOTE: the theatre goes dark over the summer — an empty July/August is
// genuinely empty, not a scrape bug.

const TZ_DEFAULT = 'Europe/Warsaw';

export interface NowyTeatrRawEvent {
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

export interface NowyTeatrScrapeResult {
  events: NowyTeatrRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** Parse one month's agenda; `ym` (YYYY-MM) anchors the rows' day numbers. */
export function parseNowyTeatrMonth(
  html: string,
  ym: string,
  timeZone: string = TZ_DEFAULT,
): NowyTeatrRawEvent[] {
  const $ = cheerio.load(html);
  const events: NowyTeatrRawEvent[] = [];

  $('.calendar__row').each((_, row) => {
    const $row = $(row);
    const dayNum = clean($row.find('h3 span').first().text()).match(/^(\d{1,2})$/)?.[1];
    if (!dayNum) return;
    const day = `${ym}-${dayNum.padStart(2, '0')}`;

    $row.find('.calendar__cell').each((__, cell) => {
      const $cell = $(cell);
      const href = $cell.find('a.calendar__link').attr('href')?.trim();
      const title = clean($cell.find('h4').first().text());
      const timeText =
        $cell.find('.calendar__time time').attr('datetime')?.trim() ||
        clean($cell.find('.calendar__time').first().text());
      const t = timeText.match(/(\d{1,2})[.:](\d{2})/);
      if (!href || !title || !t) return; // timeless banner rows are unusable
      const starts_at = toStartsAt(day, `${t[1]}:${t[2]}`, timeZone);
      if (!starts_at) return;

      const subtitle = clean($cell.find('h5').first().text());

      events.push({
        title,
        starts_at,
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: subtitle || null,
        price_min: null,
        price_max: null,
        source_url: new URL(href, 'https://nowyteatr.org').toString(),
        // No stable id in the markup; the persister keys on
        // source_url + starts_at, unique per performance.
        source_id: null,
      });
    });
  });

  return dedupe(events);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: NowyTeatrRawEvent[]): NowyTeatrRawEvent[] {
  const seen = new Set<string>();
  const out: NowyTeatrRawEvent[] = [];
  for (const e of events) {
    const key = `${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
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

/** Last calendar day (YYYY-MM-DD) of a YYYY-MM month. */
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
}

/**
 * Fetch one agenda page per calendar month covering [today, today+windowDays],
 * parse every cell, and keep in-window rows. A failed month is logged and
 * skipped rather than failing the venue.
 */
export async function scrapeNowyTeatr(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<NowyTeatrScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  const base = args.baseUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');

  const chunks: string[] = [];
  const all: NowyTeatrRawEvent[] = [];
  for (const ym of monthRange(startDay.slice(0, 7), endDay.slice(0, 7))) {
    const url = `${base}?date_from=${ym}-01&date_to=${monthEnd(ym)}`;
    try {
      const html = await fetchVenueHTML(url, { fetcher: args.fetcher });
      chunks.push(`${ym}\n${html}`);
      all.push(...parseNowyTeatrMonth(html, ym, tz));
    } catch (e) {
      console.warn(`[nowyteatr] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const events = dedupe(all).filter((e) => {
    const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
    return day >= startDay && day <= endDay;
  });
  return { events, signature: chunks.join('\n\n') };
}
