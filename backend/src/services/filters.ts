import type { Event, EventFilters, Venue } from '@goin/shared';

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
  if (venue) {
    if (f.categories?.length && !f.categories.includes(venue.category)) return false;
    if (f.cities?.length && !f.cities.map(lc).includes(lc(venue.city))) return false;
    if (f.countries?.length && !f.countries.map(lc).includes(lc(venue.country))) return false;
  }

  const start = new Date(event.startsAt);
  if (f.daysOfWeek?.length && !f.daysOfWeek.includes(start.getDay())) return false;

  if (typeof f.startHour === 'number' && start.getHours() < f.startHour) return false;
  if (typeof f.endHour === 'number' && start.getHours() > f.endHour) return false;

  if (typeof f.priceMax === 'number') {
    const price = event.priceMin ?? event.priceMax;
    if (price !== null && price > f.priceMax) return false;
  }

  return true;
}

const lc = (s: string) => s.toLowerCase();
