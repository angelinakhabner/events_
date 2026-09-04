import * as cheerio from 'cheerio';
import { fetchVenueHTML } from '../fetcher.js';
import { POLISH_MONTHS, toStartsAt, ymdInTz } from './datetime.js';

// Kino Muranów's /repertuar is a Drupal month calendar, fully server-rendered.
// One page carries the whole month, laid out as day cells:
//
//   <div class="calendar-seance-full__day calendar-seance-full__day--filled">
//     <div class="cell-date-header">
//       <span class="cell-date-header__day-name">niedziela</span>
//       <span class="cell-date-header__day-num">7</span>
//       <span class="cell-date-header__day-month-short">czerwca</span>
//     </div>
//     <div class="movie-calendar-info">
//       <div class="movie-calendar-info__inner" data-id="26919">      ← screening id
//         <span class="movie-calendar-info__date">17:00</span>        ← showtime
//         <h5 class="movie-calendar-info__title">Tajny agent</h5>
//         <div class="movie-calendar-info__cycles">…</div>            ← cycle / "English friendly"
//       <div class="movie-calendar-info-expand">
//         <a href="https://kinomuranow.pl/film/tajny-agent" …>        ← film page
//
// Every screening therefore carries an exact day + wall-clock time + a stable
// numeric id, which is what makes an LLM unnecessary here. Day cells name their
// own month ("czerwca"), so the leading/trailing cells of the calendar grid
// can't be mis-stamped with the header month.
//
// Month navigation is *not* a link: the prev/next pagers are submit buttons on
// a Drupal AJAX form that POSTs to /repertuar?ajax_form=1 and returns a command
// list whose `insert` payload is the replacement #calendar-wrapper markup. The
// cinema window is short (7 days), so extra months are only ever needed when
// the window straddles a month boundary — a failed hop is logged and skipped
// rather than failing the venue.

const TZ_DEFAULT = 'Europe/Warsaw';
const ORIGIN = 'https://kinomuranow.pl';
/** Safety rail on the AJAX month walk — a cinema window never spans this many. */
const MAX_MONTH_HOPS = 6;

export interface MuranowRawEvent {
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

export interface MuranowScrapeResult {
  events: MuranowRawEvent[];
  /** Raw material the caller hashes for its skip-unchanged check. */
  signature: string;
  /**
   * The last day (YYYY-MM-DD) this scrape could actually read.
   *
   * Equal to the end of the requested window when every month hop landed. A
   * failed hop leaves it at the end of the last month that did — see the note
   * on the hop loop for why the runner needs to be told (GOI-107).
   */
  coveredThrough: string;
}

/** The calendar header's month, as YYYY-MM, or null when it's missing/unparseable. */
export function parseMonthLabel(html: string): string | null {
  const $ = cheerio.load(html);
  const label = clean($('.calendar-seance-full__month-label').first().text());
  return monthLabelToYm(label);
}

function monthLabelToYm(label: string): string | null {
  // "Czerwiec 2026" → "2026-06"
  const m = label.match(/^(\p{L}+)\s+(\d{4})$/u);
  if (!m) return null;
  const month = POLISH_MONTHS[m[1]!.toLowerCase()];
  return month ? `${m[2]}-${String(month).padStart(2, '0')}` : null;
}

/**
 * Parse a month calendar (a full page or the AJAX `#calendar-wrapper` fragment)
 * into raw event rows.
 *
 * `fallbackYm` (YYYY-MM) anchors day cells only when the page's own header
 * label is missing — the markup is otherwise self-describing.
 */
export function parseMuranowCalendar(
  html: string,
  timeZone: string = TZ_DEFAULT,
  fallbackYm?: string,
): MuranowRawEvent[] {
  const $ = cheerio.load(html);
  const headerYm = monthLabelToYm(clean($('.calendar-seance-full__month-label').first().text()))
    ?? fallbackYm
    ?? null;
  if (!headerYm) return [];
  const [headerYear, headerMonth] = [Number(headerYm.slice(0, 4)), Number(headerYm.slice(5, 7))];

  const events: MuranowRawEvent[] = [];

  $('.calendar-seance-full__day').each((_, cell) => {
    const $cell = $(cell);
    const dayNum = clean($cell.find('.cell-date-header__day-num').first().text()).match(/^(\d{1,2})$/)?.[1];
    if (!dayNum) return; // blank spacer cell in the calendar grid

    // Trust the cell's own month name over the header: the grid's leading and
    // trailing cells belong to the adjacent month, and stamping them with the
    // header month would move those screenings by weeks.
    const cellMonth = POLISH_MONTHS[clean($cell.find('.cell-date-header__day-month-short').first().text()).toLowerCase()]
      ?? POLISH_MONTHS[clean($cell.find('.cell-date-header__day-month').first().text()).toLowerCase()]
      ?? headerMonth;
    // A December header showing a "stycznia" cell has rolled into next year
    // (and vice versa for a January header showing "grudnia").
    let year = headerYear;
    if (cellMonth === 1 && headerMonth === 12) year += 1;
    else if (cellMonth === 12 && headerMonth === 1) year -= 1;
    const day = `${year}-${String(cellMonth).padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

    $cell.find('.movie-calendar-info').each((__, info) => {
      const $info = $(info);
      const time = clean($info.find('.movie-calendar-info__date').first().text()).match(/(\d{1,2}):(\d{2})/);
      const title = clean($info.find('.movie-calendar-info__title').first().text())
        || clean($info.find('.movie-calendar-info-expand__title').first().text());
      if (!time || !title) return;
      const starts_at = toStartsAt(day, `${time[1]}:${time[2]}`, timeZone);
      if (!starts_at) return;

      const href =
        $info.find('a.movie-calendar-info-expand__thumb').attr('href')?.trim() ||
        $info.find('a.c-button-tickets--movie-link').attr('href')?.trim() ||
        null;

      events.push({
        title,
        starts_at,
        duration_minutes: null,
        language: englishFriendly($info.find('.movie-calendar-info__cycles').text()) ? 'English friendly' : null,
        director: null,
        cast: null,
        // Left null on purpose: the calendar carries no synopsis, so the
        // runner's enrichment pass fills these from each film's own page
        // (one fetch per film, not per screening) — see `enrich: true` in
        // the deterministic registry.
        description: null,
        price_min: null,
        price_max: null,
        source_url: absolutize(href) ?? `${ORIGIN}/repertuar`,
        source_id: $info.find('.movie-calendar-info__inner[data-id]').attr('data-id')?.trim() || null,
      });
    });
  });

  return dedupe(events);
}

/** Screenings subtitled in English are flagged only in the cycles blurb. */
function englishFriendly(cyclesText: string): boolean {
  return /english\s*friendly/i.test(cyclesText);
}

function absolutize(href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, ORIGIN).toString();
  } catch {
    return null;
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function dedupe(events: MuranowRawEvent[]): MuranowRawEvent[] {
  const seen = new Set<string>();
  const out: MuranowRawEvent[] = [];
  for (const e of events) {
    const key = e.source_id ? `id:${e.source_id}` : `k:${e.source_url}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Inclusive list of YYYY-MM months from `from` through `to`. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [from];
  let cur = from;
  while (cur < to && out.length <= MAX_MONTH_HOPS) {
    const [y, m] = cur.split('-').map(Number);
    const t = y! * 12 + (m! - 1) + 1;
    cur = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    out.push(cur);
  }
  return out;
}

/** The Drupal form state needed to drive the calendar's month pager. */
interface CalendarFormState {
  formBuildId: string;
  formId: string;
}

function readFormState(html: string): CalendarFormState | null {
  const $ = cheerio.load(html);
  // The page carries several Drupal forms (site search, newsletter…), each with
  // its own form_build_id. Match the calendar's specifically — a comma selector
  // would resolve in document order and hand back whichever form comes first.
  const candidates = [
    'form#mur-tickets-seances-calendar-form',
    'form:has(input[name="form_id"][value="mur_tickets_seances_calendar_form"])',
    'form:has([name="next_month_btn"])',
  ];
  for (const selector of candidates) {
    const $form = $(selector).first();
    const formBuildId = $form.find('input[name="form_build_id"]').attr('value')?.trim();
    if (!formBuildId) continue;
    const formId =
      $form.find('input[name="form_id"]').attr('value')?.trim() || 'mur_tickets_seances_calendar_form';
    return { formBuildId, formId };
  }
  return null;
}

/**
 * Advance the calendar one month via the pager's Drupal AJAX endpoint.
 *
 * Returns the replacement `#calendar-wrapper` markup plus the refreshed
 * form_build_id, so consecutive hops can be chained. Drupal hands the new id
 * back in an `update_build_id` command; when it doesn't, the current one is
 * reused (Drupal accepts a replayed build id for a cached form).
 */
export async function fetchAdjacentMonth(args: {
  baseUrl: string;
  state: CalendarFormState;
  direction: 'next' | 'prev';
  fetcher?: typeof fetch;
}): Promise<{ html: string; state: CalendarFormState }> {
  const trigger = args.direction === 'next' ? 'next_month_btn' : 'prev_month_btn';
  const label = args.direction === 'next' ? 'Następna' : 'Poprzedni';
  const url = new URL(args.baseUrl);
  url.search = 'ajax_form=1';

  const body = new URLSearchParams({
    form_build_id: args.state.formBuildId,
    form_id: args.state.formId,
    [trigger]: label,
    _triggering_element_name: trigger,
    _triggering_element_value: label,
    _drupal_ajax: '1',
  }).toString();

  const raw = await fetchVenueHTML(url.toString(), {
    fetcher: args.fetcher,
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  });

  const commands = parseAjaxCommands(raw);
  const html = commands
    .filter((c) => typeof c.data === 'string' && c.data.includes('calendar-seance-full'))
    .map((c) => c.data as string)
    .join('\n');
  if (!html) throw new Error('AJAX response carried no calendar markup');

  const rebuilt = commands.find((c) => c.command === 'update_build_id' && typeof c.new === 'string');
  return {
    html,
    state: { ...args.state, formBuildId: (rebuilt?.new as string) ?? args.state.formBuildId },
  };
}

interface AjaxCommand {
  command?: string;
  data?: unknown;
  new?: unknown;
}

function parseAjaxCommands(raw: string): AjaxCommand[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AjaxCommand[]) : [];
  } catch {
    return [];
  }
}

/**
 * Fetch the repertoire calendar across the scrape window and parse every
 * screening.
 *
 * The base page covers the current month; when the window runs past its end we
 * walk the pager forward one month at a time. Rows outside [today, today +
 * windowDays] are dropped so a month page never smuggles in screenings the
 * runner's stale-prune would then treat as missing.
 */
export async function scrapeMuranow(args: {
  baseUrl: string;
  today: Date;
  windowDays: number;
  timezone?: string;
  fetcher?: typeof fetch;
}): Promise<MuranowScrapeResult> {
  const tz = args.timezone || TZ_DEFAULT;
  const startDay = ymdInTz(args.today, tz);
  const endDay = ymdInTz(new Date(args.today.getTime() + args.windowDays * 86_400_000), tz);

  const baseHtml = await fetchVenueHTML(args.baseUrl, { fetcher: args.fetcher });
  const months = monthRange(startDay.slice(0, 7), endDay.slice(0, 7));

  const chunks: string[] = [`${months[0]}\n${baseHtml}`];
  const all: MuranowRawEvent[] = [...parseMuranowCalendar(baseHtml, tz, months[0])];

  // Only walk the pager if the window actually reaches beyond the base month.
  //
  // A hop that fails truncates the scrape, and the truncation has to be
  // reported rather than swallowed: the runner prunes its whole window on the
  // strength of a successful scrape, so a run that read August and was pruned
  // across a window reaching into September deleted every September screening
  // it had never looked at — and cancelled the saved ones (GOI-107). Reading
  // less than was asked for is recoverable; being pruned as though it were
  // everything is not. `covered` is how far this run may be trusted.
  let covered = months[0]!;
  let state = months.length > 1 ? readFormState(baseHtml) : null;
  if (months.length > 1 && !state) {
    console.warn('[muranow] month pager form not found; only the base month was scraped');
  }
  for (const ym of months.slice(1)) {
    if (!state) break;
    try {
      const hop = await fetchAdjacentMonth({
        baseUrl: args.baseUrl,
        state,
        direction: 'next',
        fetcher: args.fetcher,
      });
      state = hop.state;
      chunks.push(`${ym}\n${hop.html}`);
      all.push(...parseMuranowCalendar(hop.html, tz, ym));
      covered = ym;
    } catch (e) {
      console.warn(`[muranow] failed to advance to ${ym}: ${e instanceof Error ? e.message : e}`);
      break; // later months need this hop's build id — stop rather than spin
    }
  }

  const events = dedupe(all).filter((e) => {
    const day = e.starts_at.slice(0, 10); // YYYY-MM-DD sorts lexically
    return day >= startDay && day <= endDay;
  });
  const coveredThrough = minDay(endDay, endOfMonth(covered));
  return { events, signature: chunks.join('\n\n'), coveredThrough };
}

/** The last day of a YYYY-MM month, as YYYY-MM-DD. */
function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

function minDay(a: string, b: string): string {
  return a <= b ? a : b;
}
