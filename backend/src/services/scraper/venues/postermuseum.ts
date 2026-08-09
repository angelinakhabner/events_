import { parseEditoListing, type EditoRawEvent } from './edito.js';
import {
  isExhibitionsPage,
  parseExhibitionsPage,
  scrapeEditoWithExhibitions,
} from './edito-exhibitions.js';

/**
 * Muzeum Plakatu w Wilanowie (postermuseum.pl) — GOI-57.
 *
 * Two programmes on two differently-shaped pages, and the issue asks for both,
 * differently:
 *
 *   /wydarzenia/kalendarz-wydarzen/  → date **and** time
 *   /wystawy/                        → dates only
 *
 * Neither half is this venue's own code. The calendar is the edito CMS module
 * MNW and Królikarnia run — the site even declares
 * `<meta name="generator" content="edito">` — and the exhibition pages are the
 * shared prose-run parser in `edito-exhibitions`. All that lives here is the
 * binding: which origin, and which key the rows are filed under.
 */

const ORIGIN = 'https://www.postermuseum.pl';
/** Namespaces this venue's exhibition rows. Fixed — see `expandRun`. */
export const ID_PREFIX = 'postermuseum';

/**
 * Single-page path (tests / admin htmlOverride). The venue has two page shapes
 * and the caller passes whichever one it fetched, so pick by what's in it
 * rather than making the caller say.
 */
export function parsePosterMuseum(
  html: string,
  timeZone = 'Europe/Warsaw',
  today: Date = new Date(),
): EditoRawEvent[] {
  return isExhibitionsPage(html)
    ? parseExhibitionsPage(html, `${ORIGIN}/wystawy/obecne.html`, ID_PREFIX, timeZone, today)
    : parseEditoListing(html, `${ORIGIN}/wydarzenia/kalendarz-wydarzen/`, timeZone);
}

export function scrapePosterMuseum(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<{ events: EditoRawEvent[]; signature: string }> {
  return scrapeEditoWithExhibitions(args, ID_PREFIX);
}
