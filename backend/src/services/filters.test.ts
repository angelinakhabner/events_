import { describe, it, expect } from 'vitest';
import { filterEvents, matchesEvent } from './filters.js';
import type { Event, Venue } from '@goin/shared';

const venue: Venue = {
  id: 'v1', name: 'V', url: 'https://v', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', timezone: 'Europe/Warsaw', createdAt: '',
};

function evt(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e', venueId: 'v1', title: 't', description: null,
    startsAt: '2025-06-04T19:30:00.000Z', // Wed 19:30 UTC
    endsAt: null, durationMinutes: null, director: null, cast: [],
    category: 'cinema', language: 'pl',
    priceMin: 30, priceMax: 50, sourceUrl: 'https://l', sourceId: null, scrapedAt: '',
    ...overrides,
  };
}

describe('matchesEvent', () => {
  const venues = new Map([[venue.id, venue]]);

  it('passes when filter is empty', () => {
    expect(matchesEvent(evt(), venue, {})).toBe(true);
  });

  it('filters by category from venue', () => {
    expect(matchesEvent(evt(), venue, { categories: ['theatre'] })).toBe(false);
    expect(matchesEvent(evt(), venue, { categories: ['cinema'] })).toBe(true);
  });

  it('filters by event.category when no venue is supplied', () => {
    // events.listDefault passes an empty venues map; categories must still apply.
    expect(matchesEvent(evt({ category: 'theatre' }), undefined, { categories: ['theatre'] })).toBe(true);
    expect(matchesEvent(evt({ category: 'theatre' }), undefined, { categories: ['cinema'] })).toBe(false);
  });

  it('event.category overrides venue.category when both are present', () => {
    // After scrape, the event row carries its own category. Trust the event.
    expect(matchesEvent(evt({ category: 'theatre' }), venue, { categories: ['cinema'] })).toBe(false);
    expect(matchesEvent(evt({ category: 'theatre' }), venue, { categories: ['theatre'] })).toBe(true);
  });

  it('filters by city case-insensitively', () => {
    expect(matchesEvent(evt(), venue, { cities: ['warsaw'] })).toBe(true);
    expect(matchesEvent(evt(), venue, { cities: ['Berlin'] })).toBe(false);
  });

  it('filters by priceMax against priceMin', () => {
    expect(matchesEvent(evt(), venue, { priceMax: 20 })).toBe(false);
    expect(matchesEvent(evt(), venue, { priceMax: 40 })).toBe(true);
  });

  it('filters a list', () => {
    const list = [evt({ id: '1' }), evt({ id: '2', priceMin: 100 })];
    const out = filterEvents(list, venues, { priceMax: 60 });
    expect(out.map((e) => e.id)).toEqual(['1']);
  });

  it('filters by country case-insensitively', () => {
    expect(matchesEvent(evt(), venue, { countries: ['poland'] })).toBe(true);
    expect(matchesEvent(evt(), venue, { countries: ['Germany'] })).toBe(false);
  });

  // Time/day branches are evaluated with the server's local Date (a known
  // timezone weakness). Derive expectations from the same Date methods the
  // implementation uses so these assertions hold in any runner timezone.
  const iso = '2025-06-04T19:30:00.000Z';
  const localHour = new Date(iso).getHours();
  const localDay = new Date(iso).getDay();

  it('filters by startHour (starts at or after)', () => {
    expect(matchesEvent(evt({ startsAt: iso }), venue, { startHour: localHour })).toBe(true);
    expect(matchesEvent(evt({ startsAt: iso }), venue, { startHour: localHour + 1 })).toBe(false);
  });

  it('filters by endHour (starts at or before)', () => {
    expect(matchesEvent(evt({ startsAt: iso }), venue, { endHour: localHour })).toBe(true);
    expect(matchesEvent(evt({ startsAt: iso }), venue, { endHour: localHour - 1 })).toBe(false);
  });

  it('filters by daysOfWeek', () => {
    expect(matchesEvent(evt({ startsAt: iso }), venue, { daysOfWeek: [localDay] })).toBe(true);
    expect(matchesEvent(evt({ startsAt: iso }), venue, { daysOfWeek: [(localDay + 1) % 7] })).toBe(false);
  });

  it('lets events with no price pass a priceMax filter (absence ≠ too expensive)', () => {
    expect(matchesEvent(evt({ priceMin: null, priceMax: null }), venue, { priceMax: 10 })).toBe(true);
  });

  it('does not exclude on city/country filter when the venue is unknown', () => {
    // City and country only come from the venue — no event-level fallback. When
    // the venues map doesn't know this event's venue, we let it through rather
    // than dropping it (events.listDefault is already pre-scoped to a city).
    expect(matchesEvent(evt(), undefined, { cities: ['Berlin'] })).toBe(true);
    expect(matchesEvent(evt(), undefined, { countries: ['Germany'] })).toBe(true);
  });
});
