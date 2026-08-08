import { describe, it, expect } from 'vitest';
import { briefSummary, type BriefSummaryInput } from './newsletter';

const base: BriefSummaryInput = {
  venueNames: ['Kino Muranów', 'Kinoteka'],
  frequency: 'daily',
  sendHour: 15,
  sendMinute: 0,
  sendWeekday: 1,
  afterHour: null,
};

// GOI-30: this line used to be a fixed example printed above controls that
// said something else — "every day at 08:00" over a form set to 15:00. The
// whole point is that it now states what the reader has actually set up.
describe('briefSummary', () => {
  it('states the reader\'s own venues, cadence and time', () => {
    expect(briefSummary(base)).toBe(
      "Get what's on at Kino Muranów and Kinoteka as an email brief — every day at 15:00.",
    );
  });

  it('names the weekday for a weekly brief', () => {
    expect(briefSummary({ ...base, frequency: 'weekly', sendWeekday: 4 })).toContain(
      'every Thursday at 15:00',
    );
  });

  it('carries the minutes, zero-padded', () => {
    expect(briefSummary({ ...base, sendHour: 8, sendMinute: 5 })).toContain('at 08:05');
  });

  it('adds the after-hour cutoff only when there is one', () => {
    expect(briefSummary({ ...base, afterHour: 18 })).toContain(', everything after 18:00.');
    expect(briefSummary(base)).not.toContain('everything after');
  });

  // No venues ticked means the brief covers all of them — the form says so
  // under the venue list, and the summary has to agree.
  it('says "all your venues" when none are picked', () => {
    expect(briefSummary({ ...base, venueNames: [] })).toContain("at all your venues as");
  });

  it('reads a single venue without a conjunction', () => {
    expect(briefSummary({ ...base, venueNames: ['Kinoteka'] })).toContain('at Kinoteka as');
  });

  it('lists three, then counts the rest', () => {
    expect(briefSummary({ ...base, venueNames: ['A', 'B', 'C'] })).toContain('at A, B and C as');
    expect(briefSummary({ ...base, venueNames: ['A', 'B', 'C', 'D', 'E'] })).toContain(
      'at A, B and 3 more as',
    );
  });
});
