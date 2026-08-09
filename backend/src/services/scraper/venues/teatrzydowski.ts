import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { ymdInTz } from './datetime.js';

/**
 * Teatr Żydowski (teatr-zydowski.art.pl) — GOI-59.
 *
 * The friendliest source in the seed list. It's Drupal 7, and the repertoire
 * table is marked up with RDFa, so every row already carries a full ISO
 * instant *with the venue's real offset* — nothing to infer, nothing to
 * reconstruct from a weekday name:
 *
 *   <tr>
 *     <td class="date-day"><span property="dc:date"
 *         content="2026-08-14T19:00:00+02:00" …>14.08</span></td>
 *     <td class="date-hour"><span property="dc:date"
 *         content="2026-08-14T19:00:00+02:00" …>19:00</span></td>
 *     <td class="stage"><span>Scena Letnia przy Senatorskiej 35</span></td>
 *     <td class="title"><a href="/spektakle/…">Tytuł</a></td>
 *
 * So this parser reads the machine-readable attribute and ignores the human
 * text entirely — the printed "14.08" has no year on it, and guessing one when
 * the correct answer is sitting in the next attribute would be perverse.
 *
 * The theatre plays across several stages, some of them other people's
 * buildings (the Opera's Moniuszko hall, a garrison club). That's worth
 * keeping: it goes in the description, because "which stage" is the one thing
 * a listing can't infer from the venue name.
 */

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://www.teatr-zydowski.art.pl';

export interface TeatrZydowskiRawEvent {
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
 * Parse the repertoire table. `pageUrl` absolutizes the per-play links, which
 * are site-relative.
 */
export function parseTeatrZydowskiRepertoire(
  html: string,
  pageUrl: string = `${ORIGIN}/repertuar`,
  _timeZone: string = TZ_DEFAULT,
): TeatrZydowskiRawEvent[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const events: TeatrZydowskiRawEvent[] = [];
  const seen = new Set<string>();

  $('tr').each((_, row) => {
    const $link = $(row).find('td.title a').first();
    const title = $link.text().replace(/\s+/g, ' ').trim();
    const href = $link.attr('href')?.trim();
    if (!title || !href) return;

    // The RDFa attribute, not the printed "14.08" — it carries the year and
    // the venue's real offset. A row without one isn't a dated performance.
    const starts_at = $(row).find('[property="dc:date"][content]').first().attr('content')?.trim();
    if (!starts_at || Number.isNaN(Date.parse(starts_at))) return;

    const abs = new URL(href, base);
    if (abs.hostname !== base.hostname) return;

    const stage = $(row).find('td.stage').first().text().replace(/\s+/g, ' ').trim() || null;
    // The play's own path is stable across its run, so pair it with the date
    // to key each performance — the same play recurs a dozen times a month.
    const slug = abs.pathname.split('/').filter(Boolean).pop() ?? abs.pathname;
    const source_id = `zydowski:${slug}:${starts_at}`;
    if (seen.has(source_id)) return;
    seen.add(source_id);

    events.push({
      title,
      starts_at,
      duration_minutes: null,
      language: null,
      director: null,
      cast: null,
      description: stage,
      price_min: null,
      price_max: null,
      source_url: abs.toString(),
      source_id,
    });
  });

  return events;
}

/**
 * Fetch the repertoire and keep what falls inside the scrape window.
 *
 * One page covers it: the table is the theatre's whole published run and the
 * pager carries no further pages, so there are no sibling months to walk.
 */
export async function scrapeTeatrZydowski(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<{ events: TeatrZydowskiRawEvent[]; signature: string }> {
  const tz = args.timezone || TZ_DEFAULT;
  const html = await fetchVenueHTML(args.baseUrl, { fetcher: args.fetcher });

  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const events = parseTeatrZydowskiRepertoire(html, args.baseUrl, tz).filter((e) => {
    // Compare on the venue's calendar day, not the raw ISO prefix: a 19:00
    // Warsaw start is the same day either way, but a late one near midnight
    // would slip a day if compared as UTC.
    const day = ymdInTz(new Date(e.starts_at), tz);
    return day >= startDay && day <= endDay;
  });

  return { events, signature: `${args.baseUrl}\n${html}` };
}
