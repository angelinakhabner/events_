import { describe, it, expect } from 'vitest';
import { filterSummary, categoryLabel, formatDayKey, formatEventTime } from './format';

describe('format helpers', () => {
  it('categoryLabel capitalises', () => {
    expect(categoryLabel('cinema')).toBe('Cinema');
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
