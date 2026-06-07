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
});
