import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Klub Komediowy's /repertuar/ is a server-rendered month calendar (custom
// WordPress theme, template-events-calendar-v2). Every screening is fully
// machine-readable:
//
//   <div class=eventDay data-event-date=01.07.2026>          ← DD.MM.YYYY
//     <div class=eventItem>
//       <div class=eventTime>19:00</div>
//       <h3 class=eventTitle><a href=…/spektakl/<slug>/>Title</a></h3>
//       <span class=metaValue>75 zł</span>                    ← price
//       <span class="perfCat …">Impro</span>                  ← tags
//       <a class="btn …" href=https://tixto.pl/s/3503>KUP BILET</a>
//
// The tixto.pl/s/<id> ticket link is unique per screening — a stable
// source_id. The page's only JSON-LD is Yoast page metadata (no Event nodes),
// so the generic JSON-LD path can't cover this venue; parsing the attributes
// directly makes the LLM unnecessary. One fetch returns a whole month; the
// header's prev/next arrows link sibling months at /repertuar/YYYY-MM, which
// we follow to cover the scrape window. Descriptions live on the per-show
// /spektakl/ pages, so this venue opts into the runner's enrichment pass.

const TZ_DEFAULT = 'Europe/Warsaw';

export interface KomediowyRawEvent {
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

export interface KomediowyScrapeResult {
  events: KomediowyRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** "01.07.2026" (the calendar's data-event-date) → "2026-07-01", or null. */
export function toIsoDay(dmy: string): string | null {
  const m = dmy.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Price bounds from the calendar's price text — "75 zł", " / 75 zł", or a
 * range like "50-70 zł". "Bezpłatne"/"wstęp wolny" counts as an explicit 0;
 * no number at all means unknown (null), not free.
 */
export function parsePrice(text: string): { min: number | null; max: number | null } {
  if (/bezpłat|wstęp wolny|za darmo/i.test(text)) return { min: 0, max: 0 };
  const nums = [...text.matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((m) => Math.round(parseFloat(m[0].replace(',', '.'))));
  if (nums.length === 0) return { min: null, max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Parse one month's calendar HTML into raw event rows (validator-shaped). */
export function parseKomediowyListing(
  html: string,
  timeZone: string = TZ_DEFAULT,
): KomediowyRawEvent[] {
  const $ = cheerio.load(html);
  const events: KomediowyRawEvent[] = [];

  $('.eventDay[data-event-date]').each((_, dayEl) => {
    const $day = $(dayEl);
    const day = toIsoDay($day.attr('data-event-date') ?? '');
    if (!day) return;

    $day.find('.eventItem').each((__, el) => {
      const $item = $(el);
      const hour = $item.find('.eventTime').first().text().trim();
      const starts_at = toStartsAt(day, hour, timeZone);
      if (!starts_at) return;

      const $link = $item.find('h3.eventTitle a').first();
      const title = $link.text().replace(/\s+/g, ' ').trim();
      if (!title) return;
      const detailUrl = $link.attr('href')?.trim() || null;

      // Desktop price node first; the mobile one (" / 75 zł") as fallback.
      const priceText =
        $item.find('.eventPrice .metaValue').first().text().trim() ||
        $item.find('.metaValue.priceMobile').first().text().trim();
      const { min, max } = parsePrice(priceText);

      // Per-screening ticket id. Most items link tixto.pl/s/<id>; the odd one
      // links a tixto event page instead, which is per-show, not
      // per-screening — those fall back to null (the persister then keys on
      // source_url + starts_at).
      const source_id = ticketSourceId($item.find('.eventAction a').attr('href'));

      events.push({
        title,
        starts_at,
        duration_minutes: null,
        language: null,
        director: null,
        cast: null,
        description: null, // filled by the enrichment pass from the /spektakl/ page
        price_min: min,
        price_max: max,
        source_url: detailUrl || 'https://komediowy.pl/repertuar/',
        source_id,
      });
    });
  });

  return events;
}

function ticketSourceId(href: string | undefined): string | null {
  const id = href?.match(/tixto\.pl\/s\/(\d+)/)?.[1];
  return id ? `tixto:${id}` : null;
}

/**
 * The months the calendar header links to (prev/next arrows) and the month
 * the page is showing — from its own event days, falling back to the arrows.
 */
export function extractMonthNav(html: string): {
  prev: string | null;
  next: string | null;
  active: string | null;
} {
  const $ = cheerio.load(html);
  const month = (v: string | undefined) => v?.match(/^\d{4}-\d{2}$/)?.[0] ?? null;
  const prev = month($('a.arrowLeft.arrowDate').attr('data-month'));
  const next = month($('a.arrowRight.arrowDate').attr('data-month'));
  const firstDay = toIsoDay($('.eventDay[data-event-date]').first().attr('data-event-date') ?? '');
  const active = firstDay?.slice(0, 7) ?? (next ? addMonths(next, -1) : prev ? addMonths(prev, 1) : null);
  return { prev, next, active };
}

/** "2026-07" + delta months (can be negative). */
function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Inclusive list of YYYY-MM months from `from` through `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [from];
  let cur = from;
  while (cur < to && out.length < 24) {
    cur = addMonths(cur, 1);
    out.push(cur);
  }
  return out;
}

/** Month-page URL: https://komediowy.pl/repertuar/ + 2026-08 → …/repertuar/2026-08 */
function monthUrl(baseUrl: string, month: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${month}`;
}

function dedupeEvents(events: KomediowyRawEvent[]): KomediowyRawEvent[] {
  const seen = new Set<string>();
  const out: KomediowyRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}|${e.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Fetch the calendar across the whole scrape window and parse every event.
 * The base page carries the current month; further months inside the window
 * are one HTTP GET each at /repertuar/YYYY-MM (no LLM tokens). Month pages
 * contain their entire month, so rows outside [today, today+windowDays] are
 * dropped. Resilient: a failed month is logged and skipped rather than
 * failing the venue.
 */
export async function scrapeKomediowy(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<KomediowyScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const baseHtml = await fetchVenueHTML(args.baseUrl, { fetcher: args.fetcher });

  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  const months = monthRange(startDay.slice(0, 7), endDay.slice(0, 7));

  const htmlByMonth = new Map<string, string>();
  htmlByMonth.set(extractMonthNav(baseHtml).active ?? months[0]!, baseHtml);

  for (const m of months) {
    if (htmlByMonth.has(m)) continue; // already have the base page's month
    const url = monthUrl(args.baseUrl, m);
    try {
      htmlByMonth.set(m, await fetchVenueHTML(url, { fetcher: args.fetcher }));
    } catch (e) {
      console.warn(`[komediowy] failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const fetched = [...htmlByMonth.keys()].sort();
  const events = dedupeEvents(
    fetched
      .flatMap((m) => parseKomediowyListing(htmlByMonth.get(m)!, tz))
      .filter((e) => {
        const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
        return day >= startDay && day <= endDay;
      }),
  );
  const signature = fetched.map((m) => `${m}\n${htmlByMonth.get(m)}`).join('\n\n');
  return { events, signature };
}
