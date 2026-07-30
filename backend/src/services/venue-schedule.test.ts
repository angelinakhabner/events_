import { describe, it, expect } from 'vitest';
import { venueSchedule, VENUE_QUIET_AFTER_DAYS } from '@goin/shared';

// GOI-13: "when a theatre is dark until 19 Sep, show that near the venue".
// The state is derived from the calendar rather than a field someone has to
// remember to set, so the classification is the whole feature.
const NOW = new Date('2026-07-28T12:00:00Z');

const at = (iso: string, upcomingCount = 1) => ({ nextStartsAt: iso, upcomingCount });

describe('venueSchedule', () => {
  it('is running when something is on soon', () => {
    expect(venueSchedule(at('2026-07-29T18:00:00Z', 12), NOW)).toMatchObject({
      state: 'running',
      daysUntilNext: 1,
      upcomingCount: 12,
    });
  });

  it('is quiet when the next event is past the threshold — the "dark until" case', () => {
    // Nothing until 19 Sep: a summer break, not a broken scraper.
    expect(venueSchedule(at('2026-09-19T18:00:00Z'), NOW)).toMatchObject({
      state: 'quiet',
      nextStartsAt: '2026-09-19T18:00:00Z',
    });
  });

  it('is dark when nothing at all is upcoming', () => {
    expect(venueSchedule({ nextStartsAt: null, upcomingCount: 0 }, NOW)).toEqual({
      state: 'dark',
      nextStartsAt: null,
      upcomingCount: 0,
      daysUntilNext: null,
    });
  });

  it('treats an unparseable date as dark rather than throwing', () => {
    expect(venueSchedule(at('not-a-date'), NOW).state).toBe('dark');
  });

  it('switches exactly at the threshold, counting whole days', () => {
    const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
    expect(venueSchedule(at(days(VENUE_QUIET_AFTER_DAYS - 1)), NOW).state).toBe('running');
    expect(venueSchedule(at(days(VENUE_QUIET_AFTER_DAYS)), NOW).state).toBe('quiet');
  });

  it('rounds down, so a threshold-minus-an-hour gap is still running', () => {
    // 13.96 days out must read as 13 days, not trip the fortnight rule early.
    const almost = new Date(NOW.getTime() + VENUE_QUIET_AFTER_DAYS * 86_400_000 - 3_600_000);
    expect(venueSchedule(at(almost.toISOString()), NOW)).toMatchObject({
      state: 'running',
      daysUntilNext: VENUE_QUIET_AFTER_DAYS - 1,
    });
  });

  it('accepts a custom threshold', () => {
    expect(venueSchedule(at('2026-08-05T18:00:00Z'), NOW, 30).state).toBe('running');
    expect(venueSchedule(at('2026-08-05T18:00:00Z'), NOW, 3).state).toBe('quiet');
  });
});
