import type { Event } from '@afisz/shared';

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
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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
    if (Number.isNaN(t) || t < now.getTime()) continue;
    const day = warsawDayKey(new Date(t));
    if (t <= soonCutoff) {
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
