import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Teatr Żydowski's repertoire (GOI-150). A venue readers add themselves rather
// than a curated one, read by the model until it stopped yielding anything —
// while the page itself is a plain server-rendered Drupal table, one row per
// performance, with the exact start in the markup:
//
//   <tr>
//     <td class="date-day"><span content="2026-11-04T11:00:00+01:00">04.11</span> …</td>
//     <td class="date-hour"><span content="2026-11-04T11:00:00+01:00">11:00</span></td>
//     <td class="stage"><span>Scena Kameralna/Senatorska 35</span></td>
//     <td class="title"><a href="/spektakle/…">Niewidzialne baśnie…</a></td>
//
// Months are /repertuar/YYYY-MM (the bare /repertuar is the current one).
// Parsing it directly needs no model call, and reads next month too.

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://www.teatr-zydowski.art.pl';

export interface ZydowskiRawEvent {
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

/** Parse one month of the repertoire into raw event rows (validator-shaped). */
export function parseZydowskiRepertoire(html: string, timeZone: string = TZ_DEFAULT): ZydowskiRawEvent[] {
  const $ = cheerio.load(html);
  const events: ZydowskiRawEvent[] = [];
  const seen = new Set<string>();

  $('table.views-table tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const iso = $tr.find('td.date-hour [content], td.date-day [content]').first().attr('content') ?? '';
    const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const $link = $tr.find('td.title a').first();
    const title = clean($link.text() || $tr.find('td.title').text());
    if (!m || !title) return;
    // Re-stamped with the zone's own offset rather than the markup's, as the
    // other theatre scrapers do.
    const starts_at = toStartsAt(m[1]!, m[2]!, timeZone);
    if (!starts_at) return;
    const href = $link.attr('href')?.trim();
    const source_url = href ? new URL(href, ORIGIN).toString() : `${ORIGIN}/repertuar`;
    const key = `${source_url}|${starts_at}`;
    if (seen.has(key)) return;
    seen.add(key);

    const stage = clean($tr.find('td.stage').text());
    events.push({
      title,
      starts_at,
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: stage ? `Scena: ${stage}` : null,
      price_min: null,
      price_max: null,
      source_url,
      source_id: null,
    });
  });

  return events;
}

/** The repertoire page for one month ("YYYY-MM"). */
export function zydowskiMonthUrl(ym: string): string {
  return `${ORIGIN}/repertuar/${ym}`;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Inclusive list of YYYY-MM months from `from` through `to`. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [from];
  let cur = from;
  while (cur < to && out.length < 24) {
    const [y, mo] = cur.split('-').map(Number);
    const t = y! * 12 + (mo! - 1) + 1;
    cur = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    out.push(cur);
  }
  return out;
}

/**
 * Fetch every month the window touches and keep the in-window rows. The stored
 * venue URL may be the home page or the repertoire; the months are fetched
 * from the site's own /repertuar/YYYY-MM either way. A month that fails is
 * skipped, and the days it would have covered are not claimed as read.
 */
export async function scrapeZydowski(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<{ events: ZydowskiRawEvent[]; signature: string; coveredThrough?: string }> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  const months = monthRange(startDay.slice(0, 7), endDay.slice(0, 7));

  const pages: [string, string][] = [];
  let coveredThrough: string | undefined;
  for (const ym of months) {
    const url = zydowskiMonthUrl(ym);
    try {
      pages.push([url, await fetchVenueHTML(url, { fetcher: args.fetcher })]);
    } catch (e) {
      console.warn(`[zydowski] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
      // Read up to the day before this month, and no further.
      const first = new Date(`${ym}-01T12:00:00Z`);
      coveredThrough = ymdInTz(new Date(first.getTime() - 86_400_000), tz);
      break;
    }
  }

  const events = pages
    .flatMap(([, html]) => parseZydowskiRepertoire(html, tz))
    .filter((e) => {
      const day = e.starts_at.slice(0, 10);
      return day >= startDay && day <= endDay;
    });
  const signature = pages.map(([u, h]) => `${u}\n${h}`).join('\n\n');
  return { events, signature, ...(coveredThrough ? { coveredThrough } : {}) };
}
