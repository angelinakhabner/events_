import type { Category, EventFilters } from '@goin/shared';

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

export function categoryLabel(c: Category): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function filterSummary(filters: EventFilters, venueCount: number): string {
  const parts: string[] = [`${venueCount} venue${venueCount === 1 ? '' : 's'}`];
  if (filters.categories?.length) parts.push(filters.categories.map(categoryLabel).join(', '));
  if (typeof filters.startHour === 'number') parts.push(`After ${pad(filters.startHour)}:00`);
  if (typeof filters.endHour === 'number') parts.push(`Before ${pad(filters.endHour)}:00`);
  if (typeof filters.priceMax === 'number') parts.push(`Under ${filters.priceMax} zł`);
  return parts.join(' · ');
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
