import { describe, it, expect } from 'vitest';
import { bucketEvents, warsawDayKey } from './buckets';
import type { Event } from '@goin/shared';

function evt(startsAt: string, id = startsAt): Event {
  return {
    id, venueId: 'v', title: id, description: null,
    startsAt, endsAt: null, category: 'cinema', language: 'pl',
    director: null, cast: [], durationMinutes: null,
    priceMin: null, priceMax: null,
    sourceUrl: 'https://x', sourceId: null, scrapedAt: '',
  };
}

describe('bucketEvents', () => {
  // "now" = 2026-06-08T16:00:00+02:00 (Mon afternoon in Warsaw)
  const now = new Date('2026-06-08T14:00:00.000Z');

  it('puts events within next 30 minutes in "soon"', () => {
    const events = [
      evt('2026-06-08T14:25:00.000Z', 'in25'), // +25min → soon
      evt('2026-06-08T14:35:00.000Z', 'in35'), // +35min → later today
    ];
    const buckets = bucketEvents(events, now);
    expect(buckets.find((b) => b.key === 'soon')?.items.map((e) => e.id)).toEqual(['in25']);
    expect(buckets.find((b) => b.key === 'today')?.items.map((e) => e.id)).toEqual(['in35']);
  });

  it('treats exactly 30 minutes from now as "soon" (inclusive)', () => {
    const e = evt('2026-06-08T14:30:00.000Z', 'edge');
    const buckets = bucketEvents([e], now);
    expect(buckets.find((b) => b.key === 'soon')?.items.map((x) => x.id)).toEqual(['edge']);
  });

  it('handles midnight rollover in Europe/Warsaw', () => {
    // 23:00 Warsaw on Mon vs 00:30 Warsaw on Tue
    const lateToday = evt('2026-06-08T21:00:00.000Z', 'late'); // 23:00 Warsaw Mon
    const earlyTomorrow = evt('2026-06-08T22:30:00.000Z', 'early'); // 00:30 Warsaw Tue
    const buckets = bucketEvents([lateToday, earlyTomorrow], now);
    expect(buckets.find((b) => b.key === 'today')?.items.map((e) => e.id)).toContain('late');
    expect(buckets.find((b) => b.key === 'tomorrow')?.items.map((e) => e.id)).toContain('early');
  });

  it('omits past events', () => {
    const buckets = bucketEvents([evt('2026-06-08T12:00:00.000Z', 'past')], now);
    expect(buckets.every((b) => b.items.every((e) => e.id !== 'past'))).toBe(true);
  });

  it('caps "this week" at 7 days from now', () => {
    const within = evt('2026-06-14T10:00:00.000Z', 'd6');
    const beyond = evt('2026-06-16T10:00:00.000Z', 'd8');
    const buckets = bucketEvents([within, beyond], now);
    const week = buckets.find((b) => b.key === 'thisWeek');
    expect(week?.items.map((e) => e.id)).toEqual(['d6']);
  });

  it('hides empty buckets', () => {
    const buckets = bucketEvents([], now);
    expect(buckets).toEqual([]);
  });
});

describe('warsawDayKey', () => {
  it('uses Europe/Warsaw timezone for day boundaries', () => {
    // 2026-06-08T22:30:00Z is 00:30 next day in Warsaw (CEST +02:00)
    expect(warsawDayKey(new Date('2026-06-08T22:30:00.000Z'))).toBe('2026-06-09');
    expect(warsawDayKey(new Date('2026-06-08T21:30:00.000Z'))).toBe('2026-06-08');
  });
});
