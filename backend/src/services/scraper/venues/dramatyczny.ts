import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { toStartsAt, ymdInTz } from './datetime.js';

// Teatr Dramatyczny, read from its ticket office (GOI-150).
//
// teatrdramatyczny.pl sits behind a Cloudflare challenge that answers a plain
// fetch — and a headless browser — with 403, which is why the venue only ever
// worked through Firecrawl and stopped when that did. The ticket office at
// bilety.teatrdramatyczny.pl is not behind it, and its "Wybór terminu
// spektaklu" page lists the whole repertoire as one table: a row per day, a
// column per stage.
//
//   <tr><th>Termin</th><th class="lokalizacja24"><h2>DRAMATYCZNY, Mała Scena</h2></th>…</tr>
//   <tr class="r0">
//     <td>2026-11-04<br>ŚR</td>
//     <td class="lokalizacja24">
//       <h3>18:30</h3><div class="extra-info">FERDYDURKE</div>
//       <a class="button btn … disabled" href="#">Brak miejsc</a>
//     </td>
//     <td class="lokalizacja3"><h3>11:00</h3><div class="extra-info">LALKA</div>
//       <a class="button btn …" href="…/numerowane.html?id=6296&idt=…">Kup bilet</a></td>
//
// A sold-out performance is still a performance, so it is kept.
//
// Each row links to the theatre's own repertoire page, not to its ticket
// link: the challenge only stops bots, so a reader's browser gets through, and
// a ticket link changes the moment a show sells out ("Kup bilet" becomes "Brak
// miejsc", href "#"). The row is keyed instead on its start and title, which
// do not — so a sell-out is an update to the same row, never a cancelled one
// and a new one, which would tell whoever saved it that it was cancelled. One
// link for every show also means descriptions are written per title.

const TZ_DEFAULT = 'Europe/Warsaw';
export const DRAMATYCZNY_TICKETS_URL = 'https://bilety.teatrdramatyczny.pl/rezerwacja/termin.html';
/** Where each row links: the theatre's repertoire, as the curated venue URL. */
const REPERTOIRE_URL = 'https://teatrdramatyczny.pl/repertuar/';

export interface DramatycznyRawEvent {
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

/** Parse the ticket office's repertoire table into raw event rows. */
export function parseDramatycznyTickets(html: string, timeZone: string = TZ_DEFAULT): DramatycznyRawEvent[] {
  const $ = cheerio.load(html);
  const table = $('#repertuar-list table.table').first();

  // Stage names come from the header row, keyed by the column's class.
  const stages = new Map<string, string>();
  table.find('tr.he th').each((_, th) => {
    const cls = ($(th).attr('class') ?? '').split(/\s+/).find((c) => c.startsWith('lokalizacja'));
    const name = clean($(th).find('h2').text()).replace(/^DRAMATYCZNY,\s*/i, '');
    if (cls && name) stages.set(cls, name);
  });

  const events: DramatycznyRawEvent[] = [];
  const seen = new Set<string>();
  table.find('tr').not('.he').each((_, tr) => {
    const $tr = $(tr);
    const day = clean($tr.find('td').first().text()).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!day) return;

    $tr.find('td[class^="lokalizacja"]').each((__, td) => {
      const $td = $(td);
      const cls = ($td.attr('class') ?? '').split(/\s+/).find((c) => c.startsWith('lokalizacja')) ?? '';
      const stage = stages.get(cls) ?? null;
      // One show per cell today; walked per time so two in one cell would
      // still come out as two.
      $td.find('h3').each((___, h3) => {
        const time = clean($(h3).text());
        const title = clean($(h3).nextAll('.extra-info').first().text());
        if (!title) return;
        const starts_at = toStartsAt(day, time, timeZone);
        if (!starts_at) return;

        const source_id = `${starts_at}|${title.toLocaleLowerCase('pl-PL')}`;
        if (seen.has(source_id)) return;
        seen.add(source_id);

        events.push({
          title,
          starts_at,
          duration_minutes: null,
          language: null,
          director: null,
          cast: null,
          description: stage ? `Scena: ${stage}` : null,
          price_min: null,
          price_max: null,
          source_url: REPERTOIRE_URL,
          source_id,
        });
      });
    });
  });

  return events;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** One page carries the whole repertoire; keep what falls in the window. */
export async function scrapeDramatyczny(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<{ events: DramatycznyRawEvent[]; signature: string }> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);
  // Always the ticket office, whatever URL the venue row carries: the
  // theatre's own site cannot be read (see above).
  const html = await fetchVenueHTML(DRAMATYCZNY_TICKETS_URL, { fetcher: args.fetcher });
  const events = parseDramatycznyTickets(html, tz).filter((e) => {
    const day = e.starts_at.slice(0, 10);
    return day >= startDay && day <= endDay;
  });
  return { events, signature: `${DRAMATYCZNY_TICKETS_URL}\n${html}` };
}
