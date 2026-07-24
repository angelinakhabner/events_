import { fetchVenueHTML } from '../fetcher.js';
import { ymdInTz } from './datetime.js';

// Teatr Powszechny's /pl/repertuar is a Next.js RSC shell — the repertoire
// never appears in the served HTML (which is why the LLM path only ever saw
// ~2k chars of chrome). The page's own client code loads everything from
//
//   GET /api/repertoire?lang=pl
//
// which returns the complete listing as JSON: a UUID per showing, an absolute
// UTC start instant, running time in minutes, stage, category, per-showing
// notes (additionalProps.status_pl — "PREMIERA!", senior-day discounts …) and
// the show's slug. Reading that endpoint directly is exact and makes both the
// LLM and Firecrawl unnecessary. The show page lives at /{lang}/spektakle/{slug}.

const TZ_DEFAULT = 'Europe/Warsaw';
const DEFAULT_PAGE_URL = 'https://powszechny.com/pl/repertuar';

export interface PowszechnyRawEvent {
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

export interface PowszechnyScrapeResult {
  events: PowszechnyRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
}

/** The slice of one /api/repertoire event we rely on (defensively parsed). */
interface ApiEvent {
  repertoireEventId?: string;
  title?: string;
  date?: string;
  additionalProps?: string | null;
  hiddenFromRepertoire?: boolean;
  duration?: number | null;
  repertoireCategories?: { title?: string }[];
  showEvent?: { slug?: string; showEventId?: string; title?: string } | null;
  stage?: { name?: string } | null;
}

/** Origin + language segment of the venue's listing URL ("pl" fallback). */
function originAndLang(pageUrl: string): { origin: string; lang: string } {
  try {
    const u = new URL(pageUrl);
    const lang = u.pathname.split('/').filter(Boolean)[0] ?? 'pl';
    return { origin: u.origin, lang: /^[a-z]{2}$/i.test(lang) ? lang : 'pl' };
  } catch {
    return { origin: 'https://powszechny.com', lang: 'pl' };
  }
}

/** Parse the /api/repertoire JSON body into raw event rows (validator-shaped). */
export function parsePowszechnyRepertoire(
  json: string,
  pageUrl: string = DEFAULT_PAGE_URL,
): PowszechnyRawEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const list = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];

  const { origin, lang } = originAndLang(pageUrl);
  const events: PowszechnyRawEvent[] = [];

  for (const entry of list as ApiEvent[]) {
    if (!entry || entry.hiddenFromRepertoire) continue;
    const title = clean(entry.title ?? entry.showEvent?.title ?? '');
    const date = entry.date ?? '';
    if (!title || Number.isNaN(Date.parse(date))) continue;

    const slugOrId = entry.showEvent?.slug || entry.showEvent?.showEventId;
    const source_url = slugOrId
      ? `${origin}/${lang}/spektakle/${slugOrId}`
      : `${origin}/${lang}/repertuar`;

    const duration =
      typeof entry.duration === 'number' && Number.isInteger(entry.duration) && entry.duration > 0
        ? entry.duration
        : null;

    const badge = statusNote(entry.additionalProps);
    const stage = clean(entry.stage?.name ?? '');
    const category = clean(entry.repertoireCategories?.[0]?.title ?? '');
    const description =
      [badge, category && category.toLowerCase() !== 'spektakl' ? category : '', stage && `Scena: ${stage}`]
        .filter(Boolean)
        .join(' — ') || null;

    events.push({
      title,
      starts_at: date,
      duration_minutes: duration,
      language: null,
      director: null,
      cast: null,
      description,
      price_min: null,
      price_max: null,
      source_url,
      source_id: entry.repertoireEventId || null,
    });
  }

  return dedupe(events);
}

/** additionalProps is itself a JSON string — pull the Polish status note out. */
function statusNote(props: string | null | undefined): string {
  if (!props) return '';
  try {
    const p = JSON.parse(props) as { status_pl?: string };
    return clean(p.status_pl ?? '');
  } catch {
    return '';
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: PowszechnyRawEvent[]): PowszechnyRawEvent[] {
  const seen = new Set<string>();
  const out: PowszechnyRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ?? `${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Fetch the repertoire API (one request covers the venue's whole published
 * horizon) and keep rows inside [today, today+windowDays].
 */
export async function scrapePowszechny(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<PowszechnyScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const { origin, lang } = originAndLang(args.baseUrl);
  const apiUrl = `${origin}/api/repertoire?lang=${lang}`;
  const body = await fetchVenueHTML(apiUrl, { fetcher: args.fetcher });

  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  const events = parsePowszechnyRepertoire(body, args.baseUrl).filter((e) => {
    const day = ymdInTz(new Date(e.starts_at), tz); // instant → Warsaw calendar day
    return day >= startDay && day <= endDay;
  });

  return { events, signature: body };
}
