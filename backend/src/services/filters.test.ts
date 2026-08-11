import { describe, it, expect } from 'vitest';
import { filterEvents, matchesEvent } from './filters.js';
import type { Event, Venue } from '@afisz/shared';

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

  // Wed 4 Jun 2025, 19:30 UTC = 21:30 Wednesday in Warsaw (CEST +02:00).
  // These are fixed, not derived from Date#getHours: the point of the filter is
  // that it answers in the venue's zone regardless of where the server runs.
  const iso = '2025-06-04T19:30:00.000Z';
  const WARSAW_HOUR = 21;
  const WEDNESDAY = 3;

  it('filters by startHour (starts at or after)', () => {
    expect(matchesEvent(evt({ startsAt: iso }), venue, { startHour: WARSAW_HOUR })).toBe(true);
    expect(matchesEvent(evt({ startsAt: iso }), venue, { startHour: WARSAW_HOUR + 1 })).toBe(false);
  });

  it('filters by endHour (starts at or before)', () => {
    expect(matchesEvent(evt({ startsAt: iso }), venue, { endHour: WARSAW_HOUR })).toBe(true);
    expect(matchesEvent(evt({ startsAt: iso }), venue, { endHour: WARSAW_HOUR - 1 })).toBe(false);
  });

  it('filters by daysOfWeek', () => {
    expect(matchesEvent(evt({ startsAt: iso }), venue, { daysOfWeek: [WEDNESDAY] })).toBe(true);
    expect(matchesEvent(evt({ startsAt: iso }), venue, { daysOfWeek: [WEDNESDAY + 1] })).toBe(false);
  });

  it('reads the hour in the venue timezone, not the server\'s', () => {
    // 23:30 Warsaw on Wed is still 21:30 UTC — a UTC reading would let this
    // through an "after 22:00" filter and misfile it on the wrong weekday.
    const lateIso = '2025-06-04T21:30:00.000Z'; // 23:30 Wed in Warsaw
    expect(matchesEvent(evt({ startsAt: lateIso }), venue, { startHour: 23 })).toBe(true);
    expect(matchesEvent(evt({ startsAt: lateIso }), venue, { daysOfWeek: [WEDNESDAY] })).toBe(true);

    // 22:30 UTC Wed has already rolled over to 00:30 Thursday in Warsaw.
    const pastMidnight = '2025-06-04T22:30:00.000Z';
    expect(matchesEvent(evt({ startsAt: pastMidnight }), venue, { startHour: 1 })).toBe(false);
    expect(matchesEvent(evt({ startsAt: pastMidnight }), venue, { daysOfWeek: [WEDNESDAY + 1] })).toBe(true);
  });

  it('respects DST — the same UTC hour shifts by one in winter', () => {
    // 19:30Z is 21:30 in June (CEST) but 20:30 in January (CET).
    const winter = '2025-01-08T19:30:00.000Z';
    expect(matchesEvent(evt({ startsAt: winter }), venue, { startHour: 20 })).toBe(true);
    expect(matchesEvent(evt({ startsAt: winter }), venue, { startHour: 21 })).toBe(false);
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

describe('matchesEvent — exhibitions (GOI-67)', () => {
  const exhibition = (): Event =>
    evt({
      kind: 'exhibition',
      category: 'exhibition',
      startsAt: '2026-06-12T00:00:00+02:00',
      endsAt: '2026-09-14T00:00:00+02:00',
    });

  it('passes an unfiltered listing', () => {
    expect(matchesEvent(exhibition(), undefined, {})).toBe(true);
  });

  it('is excluded by a startHour filter — a run has no schedule to satisfy', () => {
    expect(matchesEvent(exhibition(), venue, { startHour: 18 })).toBe(false);
    // …and not merely because midnight is early: a "before 10:00" filter must
    // not sweep it in either.
    expect(matchesEvent(exhibition(), venue, { endHour: 10 })).toBe(false);
  });

  it('is excluded by a day-of-week filter for the same reason', () => {
    expect(matchesEvent(exhibition(), venue, { daysOfWeek: [5] })).toBe(false);
  });

  it('still answers category and price filters', () => {
    expect(matchesEvent(exhibition(), undefined, { categories: ['exhibition'] })).toBe(true);
    expect(matchesEvent(exhibition(), undefined, { categories: ['cinema'] })).toBe(false);
    expect(matchesEvent({ ...exhibition(), priceMin: 80 }, undefined, { priceMax: 50 })).toBe(false);
  });

  it('leaves timed rows at a museum alone', () => {
    const workshop = evt({ category: 'exhibition', startsAt: '2026-06-20T17:30:00+02:00' });
    expect(matchesEvent(workshop, venue, { startHour: 16 })).toBe(true);
    expect(matchesEvent(workshop, venue, { startHour: 18 })).toBe(false);
  });
});
