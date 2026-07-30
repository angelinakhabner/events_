import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Jassmine's /koncerty/ is a server-rendered WordPress listing. Every concert
// is one <article class="tile-concert"> carrying everything we need:
//
//   <article class="tile-concert concerts__tile">
//     <a class="tile-concert__inner" href="https://jassmine.com/concert/kinga-glyk/">
//       <figure class="tile-concert__logo-figure"><h2>Kinga Głyk</h2></figure>
//       <div class="tile-concert__date">
//         <span>30/07</span>                                  ← DD/MM, NO year
//         <span class="tile-concert__hour">19:00</span>
//         <span class="tile-concert__ticket">Sold out</span>   ← optional badge
//       <div class="tile-concert__day">
//         <span>Czwartek</span>                                ← weekday name
//         <span class="tile-concert__time"><span>19:00</span></span>
//
// The page carries the whole upcoming programme in one response (months of it,
// grouped into .concerts__week blocks) with no pagination, so a single GET
// covers any window. The site's only JSON-LD is Yoast's WebPage graph — no
// Event nodes — so the runner's generic JSON-LD path doesn't apply here.
//
// Tile dates omit the year. We infer it rolling-forward from `today` the way
// Filharmonia does (an upcoming-only listing showing "January" in December
// means next year), and then *verify* that guess against the Polish weekday
// name the tile prints — a cross-check the other year-less venues don't offer.

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://jassmine.com';

export interface JassmineRawEvent {
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

export interface JassmineScrapeResult {
  events: JassmineRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** Polish weekday names as the tiles print them, in JS `getUTCDay()` order. */
const WEEKDAY_PL = [
  'niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota',
];

/**
 * "30/07" + a reference day → "YYYY-MM-DD".
 *
 * Rolls into the next year when the date would otherwise land more than a week
 * behind `todayYmd` (the listing is upcoming-only, so an "01/02" tile seen in
 * December means next February, not ten months ago).
 *
 * When the tile also names a weekday, that settles it: we keep whichever of the
 * neighbouring years actually falls on that weekday. The roll-forward rule
 * alone can only be wrong at the year boundary, and this is exactly where the
 * weekday disambiguates — so the inference stops being a heuristic. An
 * unrecognised or missing weekday leaves the roll-forward result untouched.
 */
export function inferIsoDay(dm: string, todayYmd: string, weekdayPl?: string | null): string | null {
  const m = dm.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, '0');
  const mm = m[2]!.padStart(2, '0');
  const year = Number(todayYmd.slice(0, 4));
  if (!Number.isFinite(year)) return null;

  const weekBefore = new Date(new Date(`${todayYmd}T12:00:00Z`).getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rolled = `${year}-${mm}-${dd}` >= weekBefore ? year : year + 1;

  const target = normalizeWeekday(weekdayPl);
  if (!target) return isRealDate(`${rolled}-${mm}-${dd}`) ? `${rolled}-${mm}-${dd}` : null;

  // Prefer the rolled year, then its neighbours — the listing never spans more
  // than a year, so a match beyond ±1 would mean the markup changed shape.
  for (const y of [rolled, rolled + 1, rolled - 1]) {
    const candidate = `${y}-${mm}-${dd}`;
    if (isRealDate(candidate) && weekdayOf(candidate) === target) return candidate;
  }
  // Weekday matched no nearby year (a typo on the page, or a moved concert).
  // Trust the date over the label rather than dropping the concert.
  const fallback = `${rolled}-${mm}-${dd}`;
  return isRealDate(fallback) ? fallback : null;
}

/** Guards against 31/02-style tiles, which Date would silently roll over. */
function isRealDate(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

function weekdayOf(ymd: string): string {
  return WEEKDAY_PL[new Date(`${ymd}T12:00:00Z`).getUTCDay()]!;
}

function normalizeWeekday(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return WEEKDAY_PL.includes(s) ? s : null;
}

/** Parse the concert listing into raw event rows (validator-shaped). */
export function parseJassmineListing(
  html: string,
  todayYmd: string,
  timeZone: string = TZ_DEFAULT,
): JassmineRawEvent[] {
  const $ = cheerio.load(html);
  const events: JassmineRawEvent[] = [];

  $('article.tile-concert').each((_, el) => {
    const $tile = $(el);

    const title = clean($tile.find('.tile-concert__logo-figure h2').first().text())
      || clean($tile.find('.tile-concert__logo-figure').first().text());
    const href = $tile.find('a.tile-concert__inner').attr('href')?.trim() || null;
    if (!title || !href) return;

    // The date block also holds the hour and an optional "Sold out" badge, so
    // pick the span that actually looks like DD/MM rather than the first one.
    let dm: string | null = null;
    $tile.find('.tile-concert__date span').each((__, s) => {
      if (dm) return;
      const text = clean($(s).text());
      if (/^\d{1,2}\/\d{1,2}$/.test(text)) dm = text;
    });
    if (!dm) return;

    const weekday = clean($tile.find('.tile-concert__day > span').first().text());
    const day = inferIsoDay(dm, todayYmd, weekday);
    if (!day) return;

    const hourText =
      clean($tile.find('.tile-concert__hour').first().text()) ||
      clean($tile.find('.tile-concert__time').first().text());
    const t = hourText.match(/(\d{1,2}):(\d{2})/);
    if (!t) return; // no showtime → the validator would drop it as midnight anyway

    const starts_at = toStartsAt(day, `${t[1]}:${t[2]}`, timeZone);
    if (!starts_at) return;

    events.push({
      title,
      starts_at,
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      // The listing carries no blurb — the runner's enrichment pass fills this
      // from each concert's own page (see `enrich: true` in the registry).
      description: null,
      price_min: null,
      price_max: null,
      source_url: absolutize(href) ?? `${ORIGIN}/koncerty/`,
      // No stable id in the markup; the persister keys on source_url +
      // starts_at, which is unique per concert (a two-night run has one page
      // per night, e.g. /concert/kayah-jazzayah-3/ and /-4/).
      source_id: null,
    });
  });

  return dedupe(events);
}

function absolutize(href: string): string | null {
  try {
    return new URL(href, ORIGIN).toString();
  } catch {
    return null;
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: JassmineRawEvent[]): JassmineRawEvent[] {
  const seen = new Set<string>();
  const out: JassmineRawEvent[] = [];
  for (const e of events) {
    const key = `${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Fetch the concert listing and keep the events inside the scrape window.
 *
 * One GET is enough — the page ships the entire upcoming programme, so unlike
 * the calendar venues there are no day/month pages to walk.
 */
export async function scrapeJassmine(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<JassmineScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const html = await fetchVenueHTML(args.baseUrl, { fetcher: args.fetcher });
  const events = parseJassmineListing(html, startDay, tz).filter((e) => {
    const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
    return day >= startDay && day <= endDay;
  });

  return { events, signature: html };
}
