import { isExhibition, type Event } from '@afisz/shared';

export type BucketKey = 'soon' | 'today' | 'tomorrow' | 'thisWeek' | 'later';

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

  const buckets: Record<BucketKey, Event[]> = {
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

  // Nothing this week, but something later: show that day and say when it is.
  // Only the nearest day, not the whole tail — the question being answered is
  // "when does this start again?", not "what is the autumn programme?".
  const nearestDay = warsawDayKey(new Date(Date.parse(buckets.later[0]!.startsAt)));
  const items = buckets.later.filter(
    (e) => warsawDayKey(new Date(Date.parse(e.startsAt))) === nearestDay,
  );
  return [{ key: 'later', label: `Nearest screening on ${nearestDayLabel(items[0]!.startsAt)}`, items }];
}

const nearestDayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ,
});

/** "Fri 12 Sep" — the date named in the "Nearest screening on …" heading. */
function nearestDayLabel(iso: string): string {
  return nearestDayFmt.format(new Date(iso));
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
  const start = Date.parse(event.startsAt);
  if (Number.isNaN(start)) return false;
  if (warsawDayKey(new Date(start)) > dayKey) return false;
  if (!event.endsAt) return true;
  const end = Date.parse(event.endsAt);
  if (Number.isNaN(end)) return true;
  return warsawDayKey(new Date(end)) >= dayKey;
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

/**
 * Keep only events on the given Europe/Warsaw day; null means any day.
 *
 * A timed event matches the day it starts. An exhibition matches any day its
 * run covers (GOI-67) — asking "what's on Saturday" about a show that runs
 * June to September has one obvious answer, and start-date equality gives the
 * opposite one.
 */
export function filterEventsByDay(events: Event[], dayKey: string | null): Event[] {
  if (!dayKey) return events;
  return events.filter((e) => {
    if (isExhibition(e)) return exhibitionCoversDay(e, dayKey);
    const t = Date.parse(e.startsAt);
    return !Number.isNaN(t) && warsawDayKey(new Date(t)) === dayKey;
  });
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
