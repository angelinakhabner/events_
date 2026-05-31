import { describe, it, expect } from 'vitest';
import { filterSummary, categoryLabel, formatDayKey } from './format';

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
