import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Filharmonia Narodowa's /repertuar/ is fully server-rendered: each concert is
// a .event-list-row card carrying
//
//   <a href="/repertuar/<slug>-<numeric-id>" class="event-link">
//     <div class="event-title">…</div>
//     <div class="event-categories">Chopin i jego Europa, symfoniczny</div>
//     <div class="event-meta-info">Orchestre Symphonique de Montréal, …</div>
//   <div class="event-date"><div class="inner">24.08</div></div>   ← D.MM / DD.MM, NO year
//   <div class="day-time">poniedziałek / <span class="time">19:00</span></div>
//   <div class="event-venue">Sala Koncertowa</div>
//
// and the listing paginates ascending with ?p=2…N. The card's date has no
// year, so we infer it rolling-forward from `today` (the listing only shows
// upcoming concerts; a month far behind today's means the next year — the
// Dec→Jan wrap). Parsing directly makes the LLM unnecessary and survives the
// venue's summer break (an empty window is genuinely empty, not a scrape bug).

const TZ_DEFAULT = 'Europe/Warsaw';
/** Listing pages to walk at most — 12 events/page covers months of programme. */
const MAX_PAGES = 8;

export interface FilharmoniaRawEvent {
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

export interface FilharmoniaScrapeResult {
  events: FilharmoniaRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/**
 * "24.08" / "1.09" + a reference day → "YYYY-MM-DD", rolling into the next
 * year when the date would otherwise land more than a week behind `todayYmd`
 * (the listing is upcoming-only, so a "January" card seen in December means
 * next year, not eleven months ago).
 */
export function inferIsoDay(dm: string, todayYmd: string): string | null {
  const m = dm.trim().match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, '0');
  const mm = m[2]!.padStart(2, '0');
  const year = Number(todayYmd.slice(0, 4));
  const candidate = `${year}-${mm}-${dd}`;
  const weekBefore = new Date(new Date(`${todayYmd}T12:00:00Z`).getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return candidate >= weekBefore ? candidate : `${year + 1}-${mm}-${dd}`;
}

/** Parse one listing page into raw event rows (validator-shaped). */
export function parseFilharmoniaListing(
  html: string,
  todayYmd: string,
  timeZone: string = TZ_DEFAULT,
): FilharmoniaRawEvent[] {
  const $ = cheerio.load(html);
  const events: FilharmoniaRawEvent[] = [];

  $('div.event-list-row').each((_, el) => {
    const $card = $(el);
    const $link = $card.find('a.event-link').first();
    const href = $link.attr('href')?.trim();
    if (!href) return; // legend rows / nested wrappers without a link

    const title = clean($card.find('.event-title').first().text());
    const dm = clean($card.find('.event-date .inner').first().text()).split(/\s/)[0] ?? '';
    const day = inferIsoDay(dm, todayYmd);
    const hour = clean($card.find('.day-time .time').first().text());
    if (!title || !day) return;
    const starts_at = toStartsAt(day, hour, timeZone);
    if (!starts_at) return;

    const venue = clean($card.find('.event-venue').first().text());
    const performers = clean($card.find('.event-meta-info').first().text());
    const description =
      [performers, venue && `Miejsce: ${venue}`].filter(Boolean).join(' — ') || null;

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
      source_url: new URL(href, 'https://filharmonia.pl').toString(),
      // The slug's numeric tail is unique per concert (recurring programmes get
      // distinct ids per date). Fall back to null → persister keys on
      // source_url + starts_at.
      source_id: href.match(/-(\d{5,})$/)?.[1] ?? null,
    });
  });

  return dedupe(events);
}

function clean(s: string): string {
  // \s covers NBSP in JS regexes, so one pass normalises all whitespace.
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: FilharmoniaRawEvent[]): FilharmoniaRawEvent[] {
  const seen = new Set<string>();
  const out: FilharmoniaRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** ?p=N URL the site's own pagination uses (no trailing slash before ?). */
function pageUrl(baseUrl: string, page: number): string {
  const base = baseUrl.replace(/\/+$/, '');
  return page <= 1 ? base : `${base}?p=${page}`;
}

/**
 * Walk the paginated listing until it runs past the scrape window (the pages
 * sort ascending), parse every card, and keep rows inside
 * [today, today+windowDays]. A failed page is logged and skipped; MAX_PAGES
 * bounds the walk for safety.
 */
export async function scrapeFilharmonia(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<FilharmoniaScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const pages: string[] = [];
  const all: FilharmoniaRawEvent[] = [];

  for (let p = 1; p <= MAX_PAGES; p++) {
    let html: string;
    try {
      html = await fetchVenueHTML(pageUrl(args.baseUrl, p), { fetcher: args.fetcher });
    } catch (e) {
      console.warn(`[filharmonia] failed to fetch page ${p}: ${e instanceof Error ? e.message : e}`);
      break;
    }
    const rows = parseFilharmoniaListing(html, startDay, tz);
    pages.push(html);
    if (rows.length === 0) break; // ran off the end of the listing
    all.push(...rows);
    // Ascending pages: once this page starts beyond the window, stop walking.
    const firstDay = rows[0]!.starts_at.slice(0, 10);
    if (firstDay > endDay) break;
  }

  const events = dedupe(all).filter((e) => {
    const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
    return day >= startDay && day <= endDay;
  });
  return { events, signature: pages.join('\n\n') };
}
