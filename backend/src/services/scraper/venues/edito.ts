import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Muzeum Narodowe and Królikarnia both run the "edito" CMS (edito.pl), whose
// month calendar list view (…/kalendarz-wydarzen/MM-YYYY,lista,miesiac.html)
// is fully server-rendered:
//
//   <div class="events-list">
//     <div class="event e-project-1">
//       <div class="place">MNW</div>
//       <div class="content-short">
//         <div class="date">2026-07-01  /  10:30</div>       ← time optional
//         <h3 class="title" rel="9144:1:20:pl">
//           <a href="/wydarzenia/kalendarz-wydarzen/9144,wydarzenie.html" title="…">…</a>
//         </h3>
//         godz. 10.30 … description snippet …
//
// One parser therefore covers both venues. MNW's calendar also mixes in events
// from its branch museums (Królikarnia, Poster Museum) via absolute cross-host
// links — those are dropped so a branch's events only come from the branch's
// own venue row. Sibling months are one GET each by swapping the MM-YYYY
// segment of the listing URL.

const TZ_DEFAULT = 'Europe/Warsaw';

export interface EditoRawEvent {
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

export interface EditoScrapeResult {
  events: EditoRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** "2026-07-05 / 11:00" (time optional, dot form "11.00" tolerated) → parts. */
export function parseDateCell(text: string): { day: string; hour: string | null } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const day = t.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (!day) return null;
  const hour = t.match(/\/\s*(\d{1,2})[:.](\d{2})/)?.slice(1, 3)?.join(':') ?? null;
  return { day, hour };
}

/**
 * Parse one month-list page into raw event rows (validator-shaped).
 * `pageUrl` absolutizes the relative event links and anchors the same-host
 * filter that drops branch-museum rows.
 */
export function parseEditoListing(
  html: string,
  pageUrl: string,
  timeZone: string = TZ_DEFAULT,
): EditoRawEvent[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const events: EditoRawEvent[] = [];

  $('.events-list .event').each((_, el) => {
    const $item = $(el);
    const $short = $item.find('.content-short').first();
    const cell = parseDateCell($short.find('.date').first().text());
    if (!cell) return;
    // Timed events get the real wall-clock; undated ones fall back to local
    // midnight, which the validator accepts for the exhibition category.
    const starts_at = toStartsAt(cell.day, cell.hour ?? '0:00', timeZone);
    if (!starts_at) return;

    const $link = $short.find('h3.title a').first();
    const title = ($link.attr('title') || $link.text()).replace(/\s+/g, ' ').trim();
    const href = $link.attr('href')?.trim();
    if (!title || !href) return;

    const abs = new URL(href, base);
    if (abs.hostname !== base.hostname) return; // branch-museum row — not ours

    // Trailing text of .content-short (after the date and title) is a
    // description snippet.
    const $descr = $short.clone();
    $descr.find('.date, h3').remove();
    const description = $descr.text().replace(/\s+/g, ' ').trim() || null;

    const id = href.match(/(\d+),wydarzenie\.html/)?.[1] ?? null;

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
      source_url: abs.toString(),
      // The numeric page id is per-event but recurring events reuse it across
      // dates, so key on id + start to keep every occurrence.
      source_id: id ? `edito:${id}:${starts_at.slice(0, 10)}` : null,
    });
  });

  return dedupe(events);
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

const MONTH_SEGMENT_RE = /\d{2}-\d{4}(?=,)/;

/** Swap the MM-YYYY segment of a month-list URL ("YYYY-MM" input). */
export function monthUrl(baseUrl: string, ym: string): string | null {
  const [y, m] = ym.split('-');
  if (!y || !m || !MONTH_SEGMENT_RE.test(baseUrl)) return null;
  return baseUrl.replace(MONTH_SEGMENT_RE, `${m}-${y}`);
}

/** Inclusive list of YYYY-MM months from `from` through `to`. */
export function monthRange(from: string, to: string): string[] {
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
 * Fetch the month-list pages covering [today, today+windowDays], parse every
 * event, and keep in-window rows. The base URL (already resolved to the
 * current month by the runner's {{MM-YYYY}} substitution) doubles as the first
 * page; a failed sibling month is logged and skipped rather than failing the
 * venue.
 */
export async function scrapeEdito(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<EditoScrapeResult> {
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
      console.warn(`[edito] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const urls = [...pages.keys()].sort();
  const events = dedupe(
    urls
      .flatMap((u) => parseEditoListing(pages.get(u)!, u, tz))
      .filter((e) => {
        const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
        return day >= startDay && day <= endDay;
      }),
  );
  const signature = urls.map((u) => `${u}\n${pages.get(u)}`).join('\n\n');
  return { events, signature };
}
