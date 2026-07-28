import { parseKinotekaListing, scrapeKinoteka } from './venues/kinoteka.js';
import { parseMuranowCalendar, scrapeMuranow } from './venues/muranow.js';
import { parseKomediowyListing, scrapeKomediowy } from './venues/komediowy.js';
import { parseFilharmoniaListing, scrapeFilharmonia } from './venues/filharmonia.js';
import { parseJassmineListing, scrapeJassmine } from './venues/jassmine.js';
import { parseEditoListing, scrapeEdito } from './venues/edito.js';
import { parseTrWarszawaListing, scrapeTrWarszawa } from './venues/trwarszawa.js';
import { parseUjazdowskiDay, scrapeUjazdowski } from './venues/ujazdowski.js';
import { parseNowyTeatrMonth, scrapeNowyTeatr } from './venues/nowyteatr.js';
import { parsePowszechnyRepertoire, scrapePowszechny } from './venues/powszechny.js';
import { DEFAULT_VENUES } from '../../data/default-venues.js';
import { ymdInTz } from './venues/datetime.js';

/**
 * A venue whose listing is structured enough to parse deterministically with
 * cheerio — no LLM call. Cheaper, faster and exact where the source carries
 * machine-readable date/time (e.g. Kinoteka's per-screening data-attributes).
 *
 * `parse` handles a single pre-fetched HTML (tests / admin htmlOverride);
 * `scrape` does its own (possibly multi-page) fetching and returns the raw
 * material to hash for the runner's skip-unchanged check.
 */
export interface DeterministicScraper {
  parse(html: string, timezone: string): unknown[];
  scrape(args: {
    baseUrl: string;
    today: Date;
    windowDays: number;
    timezone?: string;
    fetcher?: typeof fetch;
  }): Promise<{ events: unknown[]; signature: string }>;
  /**
   * Run the runner's description-enrichment pass over this venue's events.
   * For listings that carry descriptions inline (Kinoteka) it stays off; for
   * ones whose descriptions live on per-event pages (Komediowy) it's the only
   * way rows get a description at all.
   */
  enrich?: boolean;
}

export const DETERMINISTIC_SCRAPERS: Record<string, DeterministicScraper> = {
  kinoteka: {
    parse: (html, timezone) => parseKinotekaListing(html, timezone),
    scrape: (args) => scrapeKinoteka(args),
  },
  'kino-muranow': {
    // The calendar names its own month in the header, so htmlOverride needs no
    // date anchor. Descriptions live on each film's page, not the calendar.
    parse: (html, timezone) => parseMuranowCalendar(html, timezone),
    scrape: (args) => scrapeMuranow(args),
    enrich: true,
  },
  'klub-komediowy': {
    parse: (html, timezone) => parseKomediowyListing(html, timezone),
    scrape: (args) => scrapeKomediowy(args),
    enrich: true,
  },
  filharmonia: {
    // htmlOverride path has no scrape date — anchor year inference to now.
    parse: (html, timezone) => parseFilharmoniaListing(html, ymdInTz(new Date(), timezone), timezone),
    scrape: (args) => scrapeFilharmonia(args),
  },
  jazzmine: {
    // htmlOverride path has no scrape date — anchor year inference to now.
    parse: (html, timezone) => parseJassmineListing(html, ymdInTz(new Date(), timezone), timezone),
    scrape: (args) => scrapeJassmine(args),
    enrich: true,
  },
  // MNW and Królikarnia share the edito CMS month-list markup; the page URL
  // passed to the parser anchors link absolutizing + the same-host filter
  // that keeps branch-museum rows out of the parent museum's venue.
  'muzeum-narodowe': {
    parse: (html, timezone) =>
      parseEditoListing(html, 'https://mnw.art.pl/wydarzenia/kalendarz-wydarzen/', timezone),
    scrape: (args) => scrapeEdito(args),
  },
  krolikarnia: {
    parse: (html, timezone) =>
      parseEditoListing(html, 'https://krolikarnia.mnw.art.pl/wydarzenia/kalendarz-wydarzen/', timezone),
    scrape: (args) => scrapeEdito(args),
  },
  'tr-warszawa': {
    parse: (html, timezone) => parseTrWarszawaListing(html, timezone),
    scrape: (args) => scrapeTrWarszawa(args),
  },
  'csw-zamek-ujazdowski': {
    // htmlOverride carries a single day fragment; stamp rows with today.
    parse: (html, timezone) =>
      parseUjazdowskiDay(html, ymdInTz(new Date(), timezone), 'https://u-jazdowski.pl', timezone),
    scrape: (args) => scrapeUjazdowski(args),
  },
  'nowy-teatr': {
    // htmlOverride carries one month's agenda; anchor day numbers to now.
    parse: (html, timezone) => parseNowyTeatrMonth(html, ymdInTz(new Date(), timezone).slice(0, 7), timezone),
    scrape: (args) => scrapeNowyTeatr(args),
  },
  'teatr-powszechny': {
    // The listing page is an RSC shell; htmlOverride carries the
    // /api/repertoire JSON body instead of HTML.
    parse: (html) => parsePowszechnyRepertoire(html),
    scrape: (args) => scrapePowszechny(args),
  },
};

// The registry is keyed by the DEFAULT_VENUES slugs, but rows in a real
// database carry random UUIDs (the seed inserts by url, never a slug id), so
// an id lookup alone never matches in production — every venue silently fell
// back to Firecrawl + LLM. Resolve by the venue URL's hostname as a fallback;
// every deterministic venue lives on its own host (Królikarnia's subdomain is
// distinct from MNW's parent domain, so exact-host matching keeps them apart).
const HOST_TO_SLUG: Record<string, string> = Object.fromEntries(
  DEFAULT_VENUES.filter((v) => v.id in DETERMINISTIC_SCRAPERS).flatMap((v) => {
    try {
      return [[new URL(v.url).hostname.replace(/^www\./, ''), v.id]];
    } catch {
      return [];
    }
  }),
);

export function getDeterministicScraper(
  venueId: string,
  venueUrl?: string,
): DeterministicScraper | undefined {
  const byId = DETERMINISTIC_SCRAPERS[venueId];
  if (byId || !venueUrl) return byId;
  try {
    const host = new URL(venueUrl).hostname.replace(/^www\./, '');
    const slug = HOST_TO_SLUG[host];
    return slug ? DETERMINISTIC_SCRAPERS[slug] : undefined;
  } catch {
    return undefined;
  }
}
