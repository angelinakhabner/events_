import type { Event, EventFilters, Venue } from '@afisz/shared';
import { hourInTz, weekdayInTz } from './scraper/venues/datetime.js';

// Every seeded venue is Warsaw; used only when a caller passes no venue (e.g.
// events.listDefault, which filters on the event's own category alone).
const DEFAULT_TZ = 'Europe/Warsaw';

export function filterEvents(
  events: Event[],
  venues: Map<string, Venue>,
  filters: EventFilters,
): Event[] {
  return events.filter((e) => matchesEvent(e, venues.get(e.venueId), filters));
}

export function matchesEvent(
  event: Event,
  venue: Venue | undefined,
  f: EventFilters,
): boolean {
  // Category comes from the event itself (DB rows) — venue lookup may be
  // empty when call sites pass an empty venues map (events.listDefault
  // intentionally does). Fall back to the venue when an event lacks one.
  if (f.categories?.length) {
    const cat = event.category ?? venue?.category;
    if (!cat || !f.categories.includes(cat)) return false;
  }
  if (venue) {
    if (f.cities?.length && !f.cities.map(lc).includes(lc(venue.city))) return false;
    if (f.countries?.length && !f.countries.map(lc).includes(lc(venue.country))) return false;
  }

  // Day and hour are wall-clock questions ("Friday", "after 19:00"), so they
  // must be asked in the venue's zone — not the server's, which is UTC.
  const start = new Date(event.startsAt);
  const tz = venue?.timezone ?? DEFAULT_TZ;
  if (f.daysOfWeek?.length && !f.daysOfWeek.includes(weekdayInTz(start, tz))) return false;

  if (typeof f.startHour === 'number' && hourInTz(start, tz) < f.startHour) return false;
  if (typeof f.endHour === 'number' && hourInTz(start, tz) > f.endHour) return false;

  if (typeof f.priceMax === 'number') {
    const price = event.priceMin ?? event.priceMax;
    if (price !== null && price > f.priceMax) return false;
  }

  return true;
}

const lc = (s: string) => s.toLowerCase();
