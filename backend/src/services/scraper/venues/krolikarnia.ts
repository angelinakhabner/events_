import { parseEditoListing, type EditoRawEvent } from './edito.js';
import {
  isExhibitionsPage,
  parseExhibitionsPage,
  scrapeEditoWithExhibitions,
} from './edito-exhibitions.js';

/**
 * Królikarnia (krolikarnia.mnw.art.pl) — GOI-43.
 *
 * The venue was already scraped, but only its event calendar, which is why
 * "I see no info": a branch museum's calendar is mostly empty, and everything
 * it actually *has on* — the exhibitions — lives on /wystawy/, a page whose
 * rows carry no dates at all, only the run as Polish prose. The seed comment
 * said as much and treated it as unusable: "/wystawy/ is undated".
 *
 * It isn't undated, it's differently dated. `edito-exhibitions` reads the run
 * ("14 maja – 25 października 2026") and expands it to all-day rows, exactly
 * as the Poster Museum's does — same CMS, same markup, same parser.
 */

const ORIGIN = 'https://krolikarnia.mnw.art.pl';
/** Namespaces this venue's exhibition rows. Fixed — see `expandRun`. */
export const ID_PREFIX = 'krolikarnia';

/** Single-page path (tests / admin htmlOverride): pick by page shape, since
 *  the venue now has two and the caller passes whichever it fetched. */
export function parseKrolikarnia(
  html: string,
  timeZone = 'Europe/Warsaw',
  today: Date = new Date(),
): EditoRawEvent[] {
  return isExhibitionsPage(html)
    ? parseExhibitionsPage(html, `${ORIGIN}/wystawy/obecne.html`, ID_PREFIX, timeZone, today)
    : parseEditoListing(html, `${ORIGIN}/wydarzenia/kalendarz-wydarzen/`, timeZone);
}

export function scrapeKrolikarnia(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<{ events: EditoRawEvent[]; signature: string }> {
  return scrapeEditoWithExhibitions(args, ID_PREFIX);
}
