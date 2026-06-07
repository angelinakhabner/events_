import { describe, it, expect } from 'vitest';
import { filterEvents, matchesEvent } from './filters.js';
import type { Event, Venue } from '@goin/shared';

const venue: Venue = {
  id: 'v1', name: 'V', url: 'https://v', city: 'Warsaw', country: 'Poland',
  category: 'cinema', language: 'pl', createdAt: '',
};

function evt(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e', venueId: 'v1', title: 't', description: null,
    startsAt: '2025-06-04T19:30:00.000Z', // Wed 19:30 UTC
    endsAt: null, durationMinutes: null, director: null, cast: [],
    genre: null, priceMin: 30, priceMax: 50, link: 'https://l', scrapedAt: '',
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

  it('does not exclude on a venue-scoped filter when the venue is unknown', () => {
    expect(matchesEvent(evt(), undefined, { categories: ['theatre'] })).toBe(true);
  });
});
