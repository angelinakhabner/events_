import * as cheerio from 'cheerio';
import type { ProbeLocale } from '@afisz/shared';

/**
 * The cost guard (GOI-72 §3E).
 *
 * Detector E is a Claude call. A restaurant's menu page, a contact page, an
 * "o nas" — none of them will ever yield an event, and paying to find that out
 * once per probe is how a check button becomes a line item. So before the model
 * is reached, count how many date-shaped things the page's *text* contains. No
 * dates, no call.
 *
 * It counts **distinct** matches: a page repeating "2024" in a footer on every
 * row is one signal, not forty.
 */

/** Distinct date-like matches needed before the extractor is worth paying for. */
export const DATE_DENSITY_THRESHOLD = 3;

/** Genitive forms — how a Polish listing actually writes a date ("12 września"). */
const PL_MONTHS_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

/** Nominative — headings and month pickers ("Wrzesień 2026"). */
const PL_MONTHS_NOMINATIVE = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];

const PL_WEEKDAYS = [
  'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela',
  'poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty', 'niedzieli',
  'pon\\.', 'wt\\.', 'śr\\.', 'czw\\.', 'pt\\.', 'sob\\.', 'niedz\\.',
];

const EN_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'jan\\.?', 'feb\\.?', 'mar\\.?', 'apr\\.?', 'jun\\.?', 'jul\\.?',
  'aug\\.?', 'sep\\.?', 'oct\\.?', 'nov\\.?', 'dec\\.?',
];

const EN_WEEKDAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

export interface DateDensity {
  /** Distinct date-like tokens found. */
  score: number;
  /** Whether the extractor is worth calling. */
  pass: boolean;
  /** Whether *any* date was found at all — separates "no events on this page"
   *  from "events, but all of them are over" (GOI-72 §3F). */
  anyDates: boolean;
}

/**
 * `locale` weights which language's names are searched first, but both are
 * always checked: a Warsaw venue's English page is still a venue's page, and a
 * mislabelled dropdown shouldn't cost us the detection.
 */
export function dateDensity(text: string, locale: ProbeLocale = 'pl'): DateDensity {
  const hay = text.toLowerCase();
  const found = new Set<string>();

  const wordSets = locale === 'en'
    ? [EN_MONTHS, EN_WEEKDAYS, PL_MONTHS_GENITIVE, PL_MONTHS_NOMINATIVE, PL_WEEKDAYS]
    : [PL_MONTHS_GENITIVE, PL_MONTHS_NOMINATIVE, PL_WEEKDAYS, EN_MONTHS, EN_WEEKDAYS];

  for (const set of wordSets) {
    for (const word of set) {
      const re = new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu');
      if (re.test(hay)) found.add(word);
    }
  }

  for (const m of hay.matchAll(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g)) {
    found.add(`num:${m[0]}`);
  }
  for (const m of hay.matchAll(/\b\d{1,2}:\d{2}\b/g)) {
    found.add(`time:${m[0]}`);
  }

  const score = found.size;
  return { score, pass: score >= DATE_DENSITY_THRESHOLD, anyDates: score > 0 };
}

/** Visible text of a page: no script, style, nav chrome or markup. */
export function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim() || $.root().text().replace(/\s+/g, ' ').trim();
}
