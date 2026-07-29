import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

/**
 * POLIN — Museum of the History of Polish Jews (GOI-31).
 *
 * `/en/kalendarium` is a Drupal view rendered through FullCalendar's list
 * layout. Unlike the other venues here it states the day outright, so no year
 * inference is needed:
 *
 *   <h4 class="fc-widget-header">
 *     <time datetime="2026-07-29"> 29.07 Wednesday </time>
 *   <div class="fc-list-table fc-list-item views-row">
 *     <span class="wydarzenia-kategoria">Exhibition</span>
 *     <span class="wydarzenia-tytul"><a href="/en/event/…">TITLE</a></span>
 *     <span class="godzina-wydarzenia"> 18:00 </span>
 *
 * Rows whose hour reads "All day" are standing exhibitions — a run rather than
 * a start instant — and are skipped, as in the Zachęta and MSN scrapers.
 *
 * NOTE ON FETCHING: polin.pl sits behind a Cloudflare interstitial that
 * answers a plain fetch with 403 no matter what headers it carries. The
 * fixture behind the tests was rendered in a real browser (the
 * `venue-diagnose` workflow's `render` job). In production this venue needs
 * FIRECRAWL_API_KEY set so the listing is rendered rather than fetched; the
 * runner already routes listing pages through Firecrawl when it is configured.
 */

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://polin.pl';
/** The calendar paginates by month; a 60-day exhibition window spans at most 3. */
const MAX_MONTHS = 3;

export interface PolinRawEvent {
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
 * The row's hour cell. Returns a start time, or null for the "All day" rows
 * that mark a standing exhibition rather than a timed event.
 */
export function parseEventHour(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || /all day|cały dzień/i.test(t)) return null;
  const m = t.match(/(\d{1,2}:\d{2})/);
  return m ? m[1]! : null;
}

/** Parse one month page into raw event rows (validator-shaped). */
export function parsePolinCalendar(
  html: string,
  timeZone: string = TZ_DEFAULT,
): PolinRawEvent[] {
  const $ = cheerio.load(html);
  const events: PolinRawEvent[] = [];
  let currentDay: string | null = null;

  // Headers and rows are siblings in reading order, so one document-order walk
  // carries the day onto the rows beneath it.
  $('h4.fc-widget-header, div.fc-list-item').each((_, el) => {
    const $el = $(el);
    if ($el.is('h4')) {
      // The <time> element states the ISO day outright — no inference needed,
      // which is what makes this the most reliable of the museum scrapers.
      const dt = $el.find('time[datetime]').attr('datetime')?.trim();
      currentDay = dt && /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : null;
      return;
    }
    if (!currentDay) return;

    const hour = parseEventHour($el.find('.godzina-wydarzenia').first().text());
    if (!hour) return; // "All day" — a standing exhibition

    const $link = $el.find('.wydarzenia-tytul a').first();
    const title = clean($link.text());
    if (!title) return;
    const starts_at = toStartsAt(currentDay, hour, timeZone);
    if (!starts_at) return;

    const href = $link.attr('href')?.trim();
    const category = clean($el.find('.wydarzenia-kategoria').first().text());

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
      source_url: href ? new URL(href, ORIGIN).toString() : `${ORIGIN}/en/kalendarium`,
      // The slug is stable per event; a title can recur on several days, so
      // the day is mixed in to keep occurrences distinct.
      source_id: href ? `${href.split('/').filter(Boolean).pop()}@${currentDay}` : null,
    });
  });

  return dedupe(events);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: PolinRawEvent[]): PolinRawEvent[] {
  const seen = new Set<string>();
  const out: PolinRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export interface PolinScrapeResult {
  events: PolinRawEvent[];
  signature: string;
}

/** `/en/kalendarium/202608` — the pager's own month URL shape. */
export function monthUrl(baseUrl: string, year: number, month: number): string {
  const base = baseUrl.replace(/\/\d{6}\/?$/, '').replace(/\/+$/, '');
  return `${base}/${year}${String(month).padStart(2, '0')}`;
}

/**
 * Walk from the current month forward until the scrape window is covered.
 * A failed month is logged and skipped rather than failing the venue — losing
 * one month is better than losing the listing.
 */
export async function scrapePolin(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<PolinScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const pages: string[] = [];
  const all: PolinRawEvent[] = [];

  const [y0, m0] = [Number(startDay.slice(0, 4)), Number(startDay.slice(5, 7))];
  for (let i = 0; i < MAX_MONTHS; i++) {
    const month = ((m0 - 1 + i) % 12) + 1;
    const year = y0 + Math.floor((m0 - 1 + i) / 12);
    // Stop once the month starts after the window ends.
    if (`${year}-${String(month).padStart(2, '0')}-01` > endDay) break;

    let html: string;
    try {
      html = await fetchVenueHTML(monthUrl(args.baseUrl, year, month), { fetcher: args.fetcher });
    } catch (e) {
      console.warn(`[polin] failed to fetch ${year}-${month}: ${e instanceof Error ? e.message : e}`);
      break;
    }
    pages.push(html);
    all.push(...parsePolinCalendar(html, tz));
  }

  const events = dedupe(all)
    .filter((e) => {
      const day = e.starts_at.slice(0, 10);
      return day >= startDay && day <= endDay;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return { events, signature: pages.join('\n') };
}
