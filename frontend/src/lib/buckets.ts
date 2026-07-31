import type { Event } from '@goin/shared';

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
export function isAllDay(event: Pick<Event, 'category' | 'startsAt'>): boolean {
  if (event.category !== 'exhibition') return false;
  const t = Date.parse(event.startsAt);
  return !Number.isNaN(t) && warsawHour(new Date(t)) === 0 && warsawMinute(new Date(t)) === 0;
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

/** Keep only events that start on the given Europe/Warsaw day; null means any day. */
export function filterEventsByDay(events: Event[], dayKey: string | null): Event[] {
  if (!dayKey) return events;
  return events.filter((e) => {
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
