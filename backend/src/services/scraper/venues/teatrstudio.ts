import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

/**
 * Teatr Studio (GOI-39).
 *
 * This venue was *deleted* in migration 0004, because its listing was a play
 * catalogue with no showtimes:
 *
 *   -- Its /spektakl/ listing is a play catalog without showtimes (yields
 *   -- undated entries) … not worth surfacing bad data.
 *
 * The site has since been rebuilt and `/repertuar` is now a real month grid
 * with times, so the reason for the removal no longer holds.
 *
 * The grid is one row per day, one column per stage:
 *
 *   <li class="js-filterItem">
 *     <div class="o-cols__item date"><p class="lead">Środa</p><p>01</p></div>
 *     <div class="o-cols__item stage" data-stage="DUŻA SCENA">
 *       <div class="hgroup">
 *         <p class="lead">G. 15:00 </p>
 *         <a href="…">TITLE</a>
 *
 * Empty cells carry `empty` and an icon instead. The month is not in the rows
 * — it comes from the pager (`?month=08-2026`), which is also how the scraper
 * walks forward.
 *
 * NOTE ON FETCHING: teatrstudio.pl answers a plain fetch, but is served
 * through Cloudflare; the fixture was rendered by the `venue-diagnose`
 * workflow's `render` job. If a live scrape starts returning the interstitial,
 * set FIRECRAWL_API_KEY so listing pages are rendered.
 */

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://teatrstudio.pl';
/** A theatre publishes a month or two ahead; three bounds the walk. */
const MAX_MONTHS = 3;

export interface TeatrStudioRawEvent {
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
 * The month the page is showing, as `YYYY-MM`.
 *
 * Read from the pager's *next* link (`?month=08-2026`) and stepped back one,
 * rather than from the highlighted label: the label is a Polish month name
 * with no year, so December's page would be ambiguous about which year it is.
 */
export function currentMonth(html: string): string | null {
  const $ = cheerio.load(html);
  const next = $('a.c-datepanel__btn--next').first().attr('href');
  const m = next?.match(/month=(\d{2})-(\d{4})/);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    // Step back one month from "next".
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  }
  // Fall back to the prev link stepped forward, for the last page of a season.
  const prev = $('a.c-datepanel__btn--prev').first().attr('href');
  const p = prev?.match(/month=(\d{2})-(\d{4})/);
  if (!p) return null;
  const month = Number(p[1]);
  const year = Number(p[2]);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/** `G. 15:00` → `15:00`; null when the cell holds no time. */
export function parseStageTime(text: string): string | null {
  const m = text.replace(/\s+/g, ' ').match(/(\d{1,2}:\d{2})/);
  return m ? m[1]! : null;
}

/** Parse one month page into raw event rows (validator-shaped). */
export function parseTeatrStudioMonth(
  html: string,
  month: string | null = null,
  timeZone: string = TZ_DEFAULT,
): TeatrStudioRawEvent[] {
  const ym = month ?? currentMonth(html);
  if (!ym) return [];
  const $ = cheerio.load(html);
  const events: TeatrStudioRawEvent[] = [];

  $('li.js-filterItem').each((_, row) => {
    const $row = $(row);
    const dayText = $row.find('.o-cols__item.date p').last().text().trim();
    const day = Number(dayText);
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    const isoDay = `${ym}-${String(day).padStart(2, '0')}`;
    // Guard against a day number the month doesn't have (a stray row).
    const probe = new Date(`${isoDay}T12:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== day) return;

    $row.find('.o-cols__item.stage').each((__, cell) => {
      const $cell = $(cell);
      if ($cell.hasClass('empty')) return;
      const stage = $cell.attr('data-stage')?.trim() ?? '';

      // A stage can host more than one performance in a day, each its own
      // hgroup — taking the first would silently drop the matinee.
      $cell.find('.hgroup').each((___, group) => {
        const $g = $(group);
        const hour = parseStageTime($g.find('p.lead').first().text());
        if (!hour) return;
        const $link = $g.find('a').first();
        const title = clean($link.text());
        if (!title) return;
        const starts_at = toStartsAt(isoDay, hour, timeZone);
        if (!starts_at) return;

        const href = $link.attr('href')?.trim();
        events.push({
          title,
          starts_at,
          duration_minutes: null,
          language: null,
          director: null,
          cast: null,
          description: stage ? `Scena: ${titleCasePl(stage)}` : null,
          price_min: null,
          price_max: null,
          source_url: href ? new URL(href, ORIGIN).toString() : `${ORIGIN}/pl/repertuar/`,
          // Slug plus the instant: the same play recurs through the month, so
          // the slug alone would collapse a whole run into one row.
          source_id: href ? `${href.split('/').filter(Boolean).pop()}@${isoDay}T${hour}` : null,
        });
      });
    });
  });

  return dedupe(events).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** "DUŻA SCENA" → "Duża scena" — the stage names are shouted in the markup. */
function titleCasePl(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl');
  return t.charAt(0).toLocaleUpperCase('pl') + t.slice(1);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: TeatrStudioRawEvent[]): TeatrStudioRawEvent[] {
  const seen = new Set<string>();
  const out: TeatrStudioRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export interface TeatrStudioScrapeResult {
  events: TeatrStudioRawEvent[];
  signature: string;
}

/** `?month=MM-YYYY` — the pager's own shape. */
export function monthUrl(baseUrl: string, year: number, month: number): string {
  const base = baseUrl.replace(/\?.*$/, '').replace(/\/+$/, '');
  return `${base}?month=${String(month).padStart(2, '0')}-${year}`;
}

/**
 * Walk from the current month forward until the window is covered. A failed
 * month is logged and skipped rather than failing the venue.
 */
export async function scrapeTeatrStudio(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<TeatrStudioScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const pages: string[] = [];
  const all: TeatrStudioRawEvent[] = [];
  const y0 = Number(startDay.slice(0, 4));
  const m0 = Number(startDay.slice(5, 7));

  for (let i = 0; i < MAX_MONTHS; i++) {
    const month = ((m0 - 1 + i) % 12) + 1;
    const year = y0 + Math.floor((m0 - 1 + i) / 12);
    if (`${year}-${String(month).padStart(2, '0')}-01` > endDay) break;

    let html: string;
    try {
      html = await fetchVenueHTML(monthUrl(args.baseUrl, year, month), { fetcher: args.fetcher });
    } catch (e) {
      console.warn(`[teatrstudio] failed to fetch ${year}-${month}: ${e instanceof Error ? e.message : e}`);
      break;
    }
    pages.push(html);
    // Trust the requested month over the page's own pager: a redirect to the
    // current month would otherwise stamp rows with the wrong one.
    all.push(...parseTeatrStudioMonth(html, `${year}-${String(month).padStart(2, '0')}`, tz));
  }

  const events = dedupe(all)
    .filter((e) => {
      const day = e.starts_at.slice(0, 10);
      return day >= startDay && day <= endDay;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return { events, signature: pages.join('\n') };
}
