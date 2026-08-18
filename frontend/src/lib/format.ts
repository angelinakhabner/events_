import type { Category, Event, EventFilters } from '@afisz/shared';
import { isAllDay, warsawDayKey, WEEK_FILTER, type DayFilter } from './buckets';

const TZ = 'Europe/Warsaw';
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
const shortDateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
const weekdayDateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });

export function formatDayKey(iso: string): string {
  return dayKeyFmt.format(new Date(iso));
}

export function formatDayLabel(iso: string): string {
  return dayFmt.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return shortDateFmt.format(new Date(iso));
}

/** "Sat 22 Aug" — the day strip's own label, and the date the "next event
 *  on…" notice names. One formatter, so the chip you didn't click and the
 *  notice telling you when to click it agree. */
export function formatWeekdayDate(value: string | Date): string {
  return weekdayDateFmt.format(typeof value === 'string' ? new Date(value) : value);
}

/**
 * The day filter as a phrase a sentence can carry: "today", "tomorrow",
 * "this week", "on Thu 20 Aug".
 *
 * "Today" and "Tomorrow" are named rather than dated because that is what
 * their chips say — a notice that answered a click on "Tomorrow" with "on Wed
 * 19 Aug" would make the reader do the arithmetic to check it had understood
 * them.
 */
export function dayFilterPhrase(filter: DayFilter, now: Date = new Date()): string {
  if (!filter) return 'in the listing';
  if (filter === WEEK_FILTER) return 'this week';
  if (filter === warsawDayKey(now)) return 'today';
  if (filter === warsawDayKey(new Date(now.getTime() + 86_400_000))) return 'tomorrow';
  // A day key is midnight UTC, which is the same Warsaw day at every time of
  // year — Warsaw is never behind UTC.
  return `on ${formatWeekdayDate(new Date(`${filter}T00:00:00.000Z`))}`;
}

/**
 * What goes in a listing row's time column (GOI-53).
 *
 * Museums don't have showtimes, they have opening days. Their undated rows
 * carry local midnight as a placeholder, and printing that as "00:00" said
 * something false — the exhibition isn't on at midnight, it's on all day. So
 * an all-day row says so instead of naming an hour.
 */
export function formatEventTime(event: Pick<Event, 'category' | 'startsAt' | 'kind'>): string {
  return isAllDay(event) ? 'All day' : formatTime(event.startsAt);
}

/**
 * What goes in an exhibition row's gutter instead of a clock (GOI-67).
 *
 * A run answers "how long have I got", not "what time". Once it has opened
 * the opening date is history, so the gutter names only the deadline; before
 * it opens both ends matter, because the first one is when you can go.
 *
 *   opened already   → "UNTIL 14 SEP"
 *   opens later      → "12 JUN – 14 SEP"
 *   one day only     → "12 JUN"
 *   no closing date  → "ONGOING" / "FROM 12 JUN"
 */
export function formatExhibitionRange(
  event: Pick<Event, 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): string {
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : NaN;
  const hasStart = !Number.isNaN(start);
  const hasEnd = !Number.isNaN(end);

  const startDay = hasStart ? formatDayKey(event.startsAt) : null;
  const endDay = hasEnd ? formatDayKey(event.endsAt!) : null;
  const today = dayKeyFmt.format(now);
  // Compared as Warsaw day keys, not instants: a show opening today has
  // already opened as far as a reader looking at the listing is concerned.
  const opened = startDay !== null && startDay <= today;

  if (!hasEnd) {
    if (!hasStart) return '';
    return opened ? 'ONGOING' : `FROM ${short(event.startsAt)}`;
  }
  if (!hasStart || startDay === endDay) return short(event.endsAt!);
  if (opened) return `UNTIL ${short(event.endsAt!)}`;
  return `${short(event.startsAt)} – ${short(event.endsAt!)}`;
}

/** "14 SEP" — the gutter's own casing, matching the uppercase meta rows. */
function short(iso: string): string {
  return formatShortDate(iso).toUpperCase();
}

/**
 * What each category is *called* on screen. One map, because the app used to
 * hold two: the category bar said "Museums" while everything reading through
 * `categoryLabel` said "Exhibition" for the same thing (GOI-30).
 *
 * "Museums" rather than "Exhibition" reads better to a casual visitor; the
 * underlying enum value stays `exhibition` so data and filters are unaffected.
 */
const CATEGORY_LABELS: Record<string, string> = {
  cinema: 'Cinema',
  theatre: 'Theatre',
  comedy: 'Comedy',
  music: 'Music',
  exhibition: 'Museums',
};

export function categoryLabel(c: Category): string {
  return CATEGORY_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * A name that is either a category or one of the reader's own venue tags —
 * the newsletter's per-category rules accept both. A known category gets the
 * app's word for it; a tag is shown exactly as it was typed, because it is
 * the reader's own wording and not ours to restyle.
 */
export function categoryOrTagLabel(name: string): string {
  return CATEGORY_LABELS[name.toLowerCase()] ?? name;
}

export function filterSummary(filters: EventFilters, venueCount: number): string {
  const parts: string[] = [`${venueCount} venue${venueCount === 1 ? '' : 's'}`];
  if (filters.categories?.length) parts.push(filters.categories.map(categoryLabel).join(', '));
  if (typeof filters.startHour === 'number') parts.push(`After ${pad(filters.startHour)}:00`);
  if (typeof filters.endHour === 'number') parts.push(`Before ${pad(filters.endHour)}:00`);
  if (typeof filters.priceMax === 'number') parts.push(`Under ${filters.priceMax} zł`);
  return parts.join(' · ');
}

/** Two-digit clock component: 8 → "08". */
export function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
