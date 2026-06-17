import type { Event } from '@goin/shared';
import { warsawDayKey } from './buckets';

/** Quick date filter applied on top of the upcoming-events list. */
export type DateRange =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'next3' }
  | { kind: 'date'; date: string }; // YYYY-MM-DD (Europe/Warsaw)

const DAY_MS = 24 * 60 * 60 * 1000;

/** The set of Warsaw day-keys an event must fall on to satisfy the range. */
function allowedDayKeys(range: DateRange, now: Date): Set<string> {
  switch (range.kind) {
    case 'today':
      return new Set([warsawDayKey(now)]);
    case 'next3':
      // Today plus the following two days — a rolling 3-day window.
      return new Set([0, 1, 2].map((d) => warsawDayKey(new Date(now.getTime() + d * DAY_MS))));
    case 'date':
      return new Set([range.date]);
    case 'all':
      return new Set();
  }
}

/** Narrow events to the chosen date range. `all` is a no-op pass-through. */
export function filterEventsByDate(events: Event[], range: DateRange, now: Date = new Date()): Event[] {
  if (range.kind === 'all') return events;
  const allowed = allowedDayKeys(range, now);
  return events.filter((e) => allowed.has(warsawDayKey(new Date(e.startsAt))));
}
