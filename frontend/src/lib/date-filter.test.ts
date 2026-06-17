import { describe, it, expect } from 'vitest';
import type { Event } from '@goin/shared';
import { filterEventsByDate, type DateRange } from './date-filter';

function event(id: string, startsAt: string): Event {
  return {
    id, venueId: 'v', title: id, description: null,
    startsAt, endsAt: null, category: 'cinema', language: 'pl',
    director: null, cast: [], durationMinutes: null,
    priceMin: null, priceMax: null, sourceUrl: 'https://x', sourceId: null, scrapedAt: '',
  };
}

// now: Mon 15 Jun 2026, 14:00 Warsaw (12:00 UTC, CEST = UTC+2).
const now = new Date('2026-06-15T12:00:00.000Z');
const events = [
  event('mon', '2026-06-15T18:00:00.000Z'), // 15 Jun
  event('tue', '2026-06-16T18:00:00.000Z'), // 16 Jun
  event('wed', '2026-06-17T18:00:00.000Z'), // 17 Jun
  event('thu', '2026-06-18T18:00:00.000Z'), // 18 Jun
];

function ids(range: DateRange) {
  return filterEventsByDate(events, range, now).map((e) => e.id);
}

describe('filterEventsByDate', () => {
  it('passes everything through for "all"', () => {
    expect(ids({ kind: 'all' })).toEqual(['mon', 'tue', 'wed', 'thu']);
  });

  it('keeps only today for "today"', () => {
    expect(ids({ kind: 'today' })).toEqual(['mon']);
  });

  it('keeps today + the next two days for "next3"', () => {
    expect(ids({ kind: 'next3' })).toEqual(['mon', 'tue', 'wed']);
  });

  it('keeps only the chosen day for "date"', () => {
    expect(ids({ kind: 'date', date: '2026-06-16' })).toEqual(['tue']);
  });

  it('returns nothing when the chosen day has no events', () => {
    expect(ids({ kind: 'date', date: '2026-06-20' })).toEqual([]);
  });
});
