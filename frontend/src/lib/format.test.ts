import { describe, it, expect } from 'vitest';
import {
  filterSummary, categoryLabel, categoryOrTagLabel, formatDayKey, formatEventTime,
  formatExhibitionRange,
} from './format';

describe('format helpers', () => {
  it('categoryLabel capitalises', () => {
    expect(categoryLabel('cinema')).toBe('Cinema');
  });

  // GOI-30: the category bar said "Museums" while everything reading through
  // categoryLabel said "Exhibition" — two names for one thing.
  it('categoryLabel calls an exhibition what the category bar calls it', () => {
    expect(categoryLabel('exhibition')).toBe('Museums');
  });

  // The newsletter's rules name either a category or one of the reader's own
  // venue tags. A tag is their wording, not ours to restyle.
  it('categoryOrTagLabel maps categories and leaves tags alone', () => {
    expect(categoryOrTagLabel('exhibition')).toBe('Museums');
    expect(categoryOrTagLabel('Cinema')).toBe('Cinema');
    expect(categoryOrTagLabel('date night')).toBe('date night');
  });

  it('filterSummary composes parts in order', () => {
    expect(
      filterSummary({ categories: ['cinema', 'theatre'], startHour: 18, priceMax: 50 }, 3),
    ).toBe('3 venues · Cinema, Theatre · After 18:00 · Under 50 zł');
  });

  it('filterSummary singular venue', () => {
    expect(filterSummary({}, 1)).toBe('1 venue');
  });

  it('formatDayKey returns ISO date', () => {
    expect(formatDayKey('2026-06-01T18:00:00.000Z')).toBe('2026-06-01');
  });
});

// GOI-53: a museum's undated row carries local midnight as a placeholder.
// Printing "00:00" said something false — it isn't on at midnight, it's on
// all day.
describe('formatEventTime', () => {
  const midnight = '2026-06-08T22:00:00.000Z'; // 00:00 Warsaw on the 9th

  it('says "All day" for an exhibition with no published hour', () => {
    expect(formatEventTime({ category: 'exhibition', startsAt: midnight })).toBe('All day');
  });

  it('keeps a museum\'s real hour when the listing printed one', () => {
    expect(formatEventTime({ category: 'exhibition', startsAt: '2026-06-09T09:00:00.000Z' }))
      .toBe('11:00');
  });

  it('leaves every other category on the clock, midnight included', () => {
    expect(formatEventTime({ category: 'cinema', startsAt: midnight })).toBe('00:00');
    expect(formatEventTime({ category: 'theatre', startsAt: '2026-06-09T17:00:00.000Z' }))
      .toBe('19:00');
  });
});

// GOI-67: an exhibition's gutter carries the run's dates, not a clock.
describe('formatExhibitionRange', () => {
  const now = new Date('2026-08-11T10:00:00+02:00');

  it('names only the deadline once the run has opened', () => {
    expect(
      formatExhibitionRange(
        { startsAt: '2026-06-12T00:00:00+02:00', endsAt: '2026-09-14T00:00:00+02:00' },
        now,
      ),
    ).toBe('UNTIL 14 SEPT');
  });

  it('names both ends while the run is still to open', () => {
    expect(
      formatExhibitionRange(
        { startsAt: '2026-09-01T00:00:00+02:00', endsAt: '2026-11-30T00:00:00+01:00' },
        now,
      ),
    ).toBe('1 SEPT – 30 NOV');
  });

  it('treats a run opening today as open', () => {
    expect(
      formatExhibitionRange(
        { startsAt: '2026-08-11T00:00:00+02:00', endsAt: '2026-08-30T00:00:00+02:00' },
        now,
      ),
    ).toBe('UNTIL 30 AUG');
  });

  it('says "until" right through the closing day', () => {
    expect(
      formatExhibitionRange(
        { startsAt: '2026-06-12T00:00:00+02:00', endsAt: '2026-08-11T00:00:00+02:00' },
        now,
      ),
    ).toBe('UNTIL 11 AUG');
  });

  it('prints a single-day run once, not as a range', () => {
    expect(
      formatExhibitionRange(
        { startsAt: '2026-09-05T00:00:00+02:00', endsAt: '2026-09-05T00:00:00+02:00' },
        now,
      ),
    ).toBe('5 SEPT');
  });

  it('falls back sensibly when no closing date was published', () => {
    expect(formatExhibitionRange({ startsAt: '2026-06-12T00:00:00+02:00', endsAt: null }, now))
      .toBe('ONGOING');
    expect(formatExhibitionRange({ startsAt: '2026-09-01T00:00:00+02:00', endsAt: null }, now))
      .toBe('FROM 1 SEPT');
  });
});
