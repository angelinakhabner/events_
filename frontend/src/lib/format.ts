import type { Category, Event, EventFilters } from '@afisz/shared';
import { isAllDay } from './buckets';

const TZ = 'Europe/Warsaw';
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
const shortDateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });

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

/**
 * What goes in a listing row's time column (GOI-53).
 *
 * Museums don't have showtimes, they have opening days. Their undated rows
 * carry local midnight as a placeholder, and printing that as "00:00" said
 * something false — the exhibition isn't on at midnight, it's on all day. So
 * an all-day row says so instead of naming an hour.
 */
export function formatEventTime(event: Pick<Event, 'category' | 'startsAt'>): string {
  return isAllDay(event) ? 'All day' : formatTime(event.startsAt);
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
