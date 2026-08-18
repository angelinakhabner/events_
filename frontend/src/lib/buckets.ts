import { isExhibition, type Event } from '@afisz/shared';

export type BucketKey =
  | 'soon' | 'today' | 'tomorrow' | 'thisWeek'
  // Fallback periods, used only when nothing is on in the coming week (GOI-82).
  | 'nextWeek' | 'thisMonth' | 'nextMonth' | 'later';

export interface Bucket {
  key: BucketKey;
  label: string;
  items: Event[];
}

const TZ = 'Europe/Warsaw';
const SOON_WINDOW_MS = 30 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Group events into the time buckets the listing shows.
 *
 * The four near buckets span a week. Anything further out used to fall through
 * every branch and vanish — and because the callers only render their empty
 * state when the *filtered* list is empty, a venue whose next event was more
 * than a week away rendered nothing at all: no rows, no explanation. Warsaw
 * theatres go dark across July and August, so in summer that was every theatre.
 *
 * So a fifth bucket carries the nearest day beyond the week, and it appears
 * *only* when the near buckets are all empty — when there is something on this
 * week, the page stays a "what's on now" listing rather than trailing months of
 * autumn programme behind it.
 */
export function bucketEvents(events: Event[], now: Date = new Date()): Bucket[] {
  const sorted = dedupeAllDay([...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  const soonCutoff = now.getTime() + SOON_WINDOW_MS;
  const weekCutoff = now.getTime() + WEEK_WINDOW_MS;
  const todayDay = warsawDayKey(now);
  const tomorrowDay = warsawDayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  // Only the near buckets plus the catch-all are filled here; the period keys
  // are assigned later, by fallbackBuckets, from whatever lands in `later`.
  const buckets: Record<'soon' | 'today' | 'tomorrow' | 'thisWeek' | 'later', Event[]> = {
    soon: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
  };

  for (const e of sorted) {
    // Exhibitions have their own section (GOI-67) — they run all week, so
    // every bucket would claim them and none would be telling the truth.
    // Callers normally split first; this keeps a caller that doesn't from
    // filling "Starting soon" with three-month runs.
    if (isExhibition(e)) continue;
    const t = Date.parse(e.startsAt);
    if (Number.isNaN(t)) continue;
    const day = warsawDayKey(new Date(t));
    const allDay = isAllDay(e);
    // A dated event is over once it has started; an all-day one is on until
    // the day ends. Dropping it at `t < now` hid every museum from its own
    // listing — its rows carry local midnight, so by breakfast "today" was
    // already in the past and the soonest surviving row was tomorrow's.
    if (allDay ? day < todayDay : t < now.getTime()) continue;
    if (t <= soonCutoff && !allDay) {
      buckets.soon.push(e);
    } else if (day === todayDay) {
      buckets.today.push(e);
    } else if (day === tomorrowDay) {
      buckets.tomorrow.push(e);
    } else if (t <= weekCutoff) {
      buckets.thisWeek.push(e);
    } else {
      buckets.later.push(e);
    }
  }

  const nearAll: Bucket[] = [
    { key: 'soon', label: 'Starting soon', items: buckets.soon },
    { key: 'today', label: 'Later today', items: buckets.today },
    { key: 'tomorrow', label: 'Tomorrow', items: buckets.tomorrow },
    { key: 'thisWeek', label: 'This week', items: buckets.thisWeek },
  ];
  const near = nearAll.filter((b) => b.items.length > 0);
  if (near.length > 0 || buckets.later.length === 0) return near;

  // Nothing this week, but something later.
  return fallbackBuckets(buckets.later, now);
}

/** Enough rows for the fallback to be worth reading rather than a stub. */
export const FALLBACK_MIN_EVENTS = 5;
/** …and a ceiling, so an empty week doesn't unroll the whole autumn. */
export const FALLBACK_MAX_EVENTS = 12;

/**
 * What to show when the coming week is empty (GOI-82).
 *
 * The old rule was "the nearest day, and nothing after it" — which answered
 * "when does this start again?" precisely, and then stopped. In a Warsaw
 * summer that regularly meant a single row on a page, which reads as breakage
 * rather than as a quiet season.
 *
 * So: start from the nearest day, and if that leaves fewer than
 * {@link FALLBACK_MIN_EVENTS} rows, keep taking whole days until there are
 * enough — never past {@link FALLBACK_MAX_EVENTS}. Whole days, because
 * stopping mid-evening would silently hide the 20:30 showing of something
 * whose 18:00 made the cut.
 *
 * The headings become periods rather than one date. "Next week" and "Next
 * month" say how far off the programme resumes at a glance, which a single
 * "Nearest screening on Sat 12 Sept" only says if you do the arithmetic.
 */
export function fallbackBuckets(later: Event[], now: Date): Bucket[] {
  if (later.length === 0) return [];

  const byDay = groupConsecutiveDays(later);
  const taken: Event[] = [];
  for (const day of byDay) {
    // Stop once there is enough to read — but always finish the day started,
    // and never exceed the ceiling.
    if (taken.length >= FALLBACK_MIN_EVENTS) break;
    if (taken.length + day.length > FALLBACK_MAX_EVENTS) break;
    taken.push(...day);
  }
  // A single day bigger than the ceiling still has to render something.
  if (taken.length === 0) taken.push(...later.slice(0, FALLBACK_MAX_EVENTS));

  const order: BucketKey[] = ['thisWeek', 'nextWeek', 'thisMonth', 'nextMonth', 'later'];
  const groups = new Map<BucketKey, Event[]>();
  for (const e of taken) {
    const key = periodKey(e.startsAt, now);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  return order
    .filter((key) => groups.get(key)?.length)
    .map((key) => ({ key, label: PERIOD_LABEL[key], items: groups.get(key)! }));
}

const PERIOD_LABEL: Record<BucketKey, string> = {
  soon: 'Starting soon',
  today: 'Later today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  nextWeek: 'Next week',
  thisMonth: 'This month',
  nextMonth: 'Next month',
  later: 'Later',
};

/** Events split into runs of the same Warsaw day, in order. */
function groupConsecutiveDays(events: Event[]): Event[][] {
  const out: Event[][] = [];
  let currentDay = '';
  for (const e of events) {
    const day = warsawDayKey(new Date(Date.parse(e.startsAt)));
    if (day !== currentDay) {
      out.push([]);
      currentDay = day;
    }
    out[out.length - 1]!.push(e);
  }
  return out;
}

/**
 * Which period an event falls in, relative to now (GOI-82).
 *
 * Weeks are checked before months because they are the finer answer: an event
 * eight days out is better described as "next week" than as "this month",
 * even though both are true.
 */
export function periodKey(iso: string, now: Date): BucketKey {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'later';
  const day = warsawDayKey(new Date(t));

  const weekStart = warsawWeekStart(now);
  const thisWeekEnd = warsawDayKey(addDays(weekStart, 7));
  const nextWeekEnd = warsawDayKey(addDays(weekStart, 14));
  if (day < thisWeekEnd) return 'thisWeek';
  if (day < nextWeekEnd) return 'nextWeek';

  const month = day.slice(0, 7);
  const nowMonth = warsawDayKey(now).slice(0, 7);
  if (month === nowMonth) return 'thisMonth';
  if (month === nextMonthKey(nowMonth)) return 'nextMonth';
  return 'later';
}

/** Monday 00:00 of the Warsaw week containing `now`. */
function warsawWeekStart(now: Date): Date {
  const day = warsawDayKey(now);
  const [y, m, d] = day.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(y!, m! - 1, d!));
  // getUTCDay: 0 = Sunday. Monday-based weeks match how a Polish calendar reads.
  const offset = (utcMidnight.getUTCDay() + 6) % 7;
  return addDays(utcMidnight, -offset);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function nextMonthKey(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m!, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─── Museums (GOI-53) ────────────────────────────────────────────────────────

/**
 * Whether an event runs all day rather than starting at a time.
 *
 * Museums publish runs, not showtimes: the scrapers fall back to local
 * midnight when a listing prints no hour, and the validator accepts that for
 * the exhibition category. So "starts at Warsaw midnight, and is an
 * exhibition" is exactly the "no hour was published" marker — and a museum's
 * genuinely timed rows (an 11:00 guided tour) keep their hour, because they
 * carry one.
 */
export function isAllDay(event: Pick<Event, 'category' | 'startsAt' | 'kind'>): boolean {
  // A row that says what it is doesn't need to be guessed at (GOI-67). The
  // midnight heuristic below stays for rows written before `kind` existed —
  // they keep rendering as they did until the next sweep re-extracts them.
  if (isExhibition(event)) return true;
  if (event.category !== 'exhibition') return false;
  const t = Date.parse(event.startsAt);
  return !Number.isNaN(t) && warsawHour(new Date(t)) === 0 && warsawMinute(new Date(t)) === 0;
}

// ─── Exhibitions vs timed events (GOI-67) ────────────────────────────────────

/**
 * Split a listing into the rows that belong in time buckets and the runs that
 * don't.
 *
 * Only rows carrying `kind: 'exhibition'` are pulled out. A legacy all-day
 * museum row (midnight placeholder, no closing date) stays in the buckets
 * where it has always been: there is no range to print in the gutter, so
 * moving it to a section headed by date ranges would show it worse, not
 * better.
 *
 * Exhibitions come back sorted by closing date, soonest first — the one thing
 * about a run that is actually urgent.
 */
export function splitExhibitions(events: Event[]): { timed: Event[]; exhibitions: Event[] } {
  const timed: Event[] = [];
  const exhibitions: Event[] = [];
  for (const e of events) (isExhibition(e) ? exhibitions : timed).push(e);
  exhibitions.sort(
    (a, b) => (a.endsAt ?? '').localeCompare(b.endsAt ?? '') || a.title.localeCompare(b.title),
  );
  return { timed, exhibitions };
}

/**
 * Whether an exhibition is on during a given Europe/Warsaw day — range
 * overlap, inclusive at both ends, rather than the equality a showtime gets.
 * An exhibition with no closing date can't be bounded, so it counts from its
 * opening day onward.
 */
export function exhibitionCoversDay(
  event: Pick<Event, 'startsAt' | 'endsAt'>,
  dayKey: string,
): boolean {
  return exhibitionCoversRange(event, { fromDay: dayKey, toDay: dayKey });
}

/**
 * Collapse an all-day run to a single row (GOI-53).
 *
 * An exhibition open for three months arrives as one row per day, all with the
 * same title, which buried everything else in the listing under one museum.
 * Keeping the earliest surviving row answers the question the listing is
 * asking — what can I see today — without repeating it thirty times.
 *
 * Keyed on venue *and* title: two museums running shows that happen to share a
 * name are two things you can go to, and collapsing them would hide a venue.
 * Timed rows are left alone, so a museum's 11:00 and 15:00 tours of the same
 * exhibition both survive.
 *
 * Expects `events` sorted by start, and preserves that order.
 */
export function dedupeAllDay(events: Event[]): Event[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!isAllDay(e)) return true;
    const key = `${e.venueId}|${normaliseTitle(e.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Titles differing only in case, spacing or a trailing full stop are the
 *  same show — venues are not consistent about any of the three. */
function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
}

// ─── The day filter (GOI-88) ─────────────────────────────────────────────────

/**
 * What the day strip can be set to: a Europe/Warsaw day key (YYYY-MM-DD),
 * {@link WEEK_FILTER} for the coming week, or null for any day.
 */
export type DayFilter = string | null;

/** The "This week" chip's value — a scope rather than a date, so it can't
 *  collide with a day key. */
export const WEEK_FILTER = 'week';

/** Today plus six more days. The same window `bucketEvents` calls "this
 *  week", so the chip and the bucket heading mean one thing. */
export const WEEK_DAYS = 7;

export interface DayRange {
  /** Inclusive Warsaw day keys, YYYY-MM-DD. */
  fromDay: string;
  toDay: string;
}

/**
 * The Warsaw day window a filter selects, or null for "any day".
 *
 * A single day is a one-day window rather than a special case, so everything
 * downstream — the SQL narrowing, the client filter, the venue counts — has
 * exactly one shape to handle.
 */
export function dayFilterRange(filter: DayFilter, now: Date = new Date()): DayRange | null {
  if (!filter) return null;
  if (filter === WEEK_FILTER) {
    return {
      fromDay: warsawDayKey(now),
      toDay: warsawDayKey(new Date(now.getTime() + (WEEK_DAYS - 1) * 86_400_000)),
    };
  }
  return { fromDay: filter, toDay: filter };
}

/**
 * Keep only events inside the day filter's window; null means any day.
 *
 * A timed event matches the day it starts. An exhibition matches any day its
 * run covers (GOI-67) — asking "what's on Saturday" about a show that runs
 * June to September has one obvious answer, and start-date equality gives the
 * opposite one.
 */
export function filterEventsByDay(
  events: Event[],
  filter: DayFilter,
  now: Date = new Date(),
): Event[] {
  const range = dayFilterRange(filter, now);
  if (!range) return events;
  return events.filter((e) => {
    if (isExhibition(e)) return exhibitionCoversRange(e, range);
    const t = Date.parse(e.startsAt);
    if (Number.isNaN(t)) return false;
    const day = warsawDayKey(new Date(t));
    return day >= range.fromDay && day <= range.toDay;
  });
}

/**
 * Keep only what is on from this Warsaw day onward.
 *
 * The listing under a "next event on…" notice starts where the reader was
 * looking, not where the calendar is: asked about a quiet Thursday, "the
 * nearest events" means Friday's, and answering with Tuesday evening's would
 * be pointing backwards.
 */
export function filterEventsFrom(events: Event[], fromDay: string): Event[] {
  return events.filter((e) => {
    if (isExhibition(e)) return !e.endsAt || dayKeyOf(e.endsAt) >= fromDay;
    const t = Date.parse(e.startsAt);
    return !Number.isNaN(t) && warsawDayKey(new Date(t)) >= fromDay;
  });
}

/**
 * The rows a listing will actually render.
 *
 * `bucketEvents` drops what has already started, so a caller that decides
 * "did my filter match anything?" from the raw list gets it wrong at the end
 * of the day: by 22:00 "Today" is a list of events that have all already
 * begun, which bucketed to nothing and drew a blank page under a filter that
 * looked applied. Asking this first is what turns that into the "next event
 * on…" notice.
 */
export function visibleEvents(events: Event[], now: Date = new Date()): Event[] {
  const todayDay = warsawDayKey(now);
  return events.filter((e) => {
    if (isExhibition(e)) return !e.endsAt || dayKeyOf(e.endsAt) >= todayDay;
    const t = Date.parse(e.startsAt);
    if (Number.isNaN(t)) return false;
    // Same rule as `bucketEvents`: an all-day row is on until its day is out.
    return isAllDay(e) ? warsawDayKey(new Date(t)) >= todayDay : t >= now.getTime();
  });
}

/**
 * When the next thing happens, as an ISO start — what the "next event on…"
 * notice names.
 *
 * Exhibitions are skipped when anything timed is on: a run has no "next
 * date", it is simply on, and naming its opening day would answer a question
 * about the coming week with a date in June.
 */
export function nextEventStart(events: Event[], now: Date = new Date()): string | null {
  let best: string | null = null;
  let bestAt = Infinity;
  for (const e of visibleEvents(events, now)) {
    if (isExhibition(e)) continue;
    // Compared as instants, not strings: a row written with a `+02:00` offset
    // sorts before a `Z` one that is genuinely earlier.
    const t = Date.parse(e.startsAt);
    if (t < bestAt) {
      bestAt = t;
      best = e.startsAt;
    }
  }
  return best;
}

/** Whether an exhibition's run overlaps a day window. */
function exhibitionCoversRange(
  event: Pick<Event, 'startsAt' | 'endsAt'>,
  range: DayRange,
): boolean {
  const start = Date.parse(event.startsAt);
  if (Number.isNaN(start)) return false;
  if (warsawDayKey(new Date(start)) > range.toDay) return false;
  if (!event.endsAt) return true;
  const end = Date.parse(event.endsAt);
  if (Number.isNaN(end)) return true;
  return warsawDayKey(new Date(end)) >= range.fromDay;
}

function dayKeyOf(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : warsawDayKey(new Date(t));
}

/**
 * Keep only events starting at or after `fromHour` on their own Europe/Warsaw
 * day; null means any time. Pairs with `filterEventsByDay` to express "today
 * after 16:00" — the hour is a wall-clock cutoff, not an absolute instant, so
 * on an unfiltered day it reads as "evenings only" across the whole week.
 */
export function filterEventsFromHour(events: Event[], fromHour: number | null): Event[] {
  if (fromHour === null) return events;
  return events.filter((e) => {
    // A time filter is a statement about scheduling, and an exhibition has no
    // schedule to satisfy (GOI-67). Keeping it would answer "what's on after
    // 18:00" with something that is equally on at 11:00.
    if (isExhibition(e)) return false;
    const t = Date.parse(e.startsAt);
    return !Number.isNaN(t) && warsawHour(new Date(t)) >= fromHour;
  });
}

/** YYYY-MM-DD in Europe/Warsaw. */
export function warsawDayKey(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

const hourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', hour12: false,
});

/**
 * Hour-of-day (0–23) in Europe/Warsaw. `Date#getHours` would answer in the
 * viewer's own zone, which is wrong for anyone reading the Warsaw listing from
 * elsewhere — and wrong on the server, which runs in UTC.
 */
export function warsawHour(d: Date): number {
  // en-GB h23 renders midnight as "24" in some ICU versions; normalise it.
  return Number(hourFmt.format(d)) % 24;
}

const minuteFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, minute: '2-digit' });

/** Minute-of-hour in Europe/Warsaw — pairs with `warsawHour` to spot the
 *  exact-midnight rows the scrapers use for "no hour published". */
export function warsawMinute(d: Date): number {
  return Number(minuteFmt.format(d));
}
