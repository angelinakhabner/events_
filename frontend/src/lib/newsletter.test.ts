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
      'The next 24 hours at Kino Muranów and Kinoteka, emailed to your inbox every day at 15:00.',
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
    expect(briefSummary({ ...base, afterHour: 18 })).toContain(
      '— only what starts after 18:00.',
    );
    expect(briefSummary(base)).not.toContain('only what starts after');
  });

  // No venues ticked means the brief covers all of them — the form says so
  // under the venue list, and the summary has to agree.
  it('says "all your venues" when none are picked', () => {
    expect(briefSummary({ ...base, venueNames: [] })).toContain('at all your venues,');
  });

  it('reads a single venue without a conjunction', () => {
    expect(briefSummary({ ...base, venueNames: ['Kinoteka'] })).toContain('at Kinoteka,');
  });

  it('lists three, then counts the rest', () => {
    expect(briefSummary({ ...base, venueNames: ['A', 'B', 'C'] })).toContain('at A, B and C,');
    expect(briefSummary({ ...base, venueNames: ['A', 'B', 'C', 'D', 'E'] })).toContain(
      'at A, B and 3 more,',
    );
  });

  /**
   * GOI-97. The cadence used to be the whole of what the line said about
   * content, and it does not answer "how much is in it" — the sweep turns
   * daily/weekly/monthly into a 1-, 7- or 30-day horizon, and that is the
   * difference between one evening's listings and a month of them.
   */
  describe('how much the brief covers', () => {
    it('states the horizon each cadence actually means', () => {
      expect(briefSummary(base)).toContain('The next 24 hours at');
      expect(briefSummary({ ...base, frequency: 'weekly' })).toContain('The next 7 days at');
      expect(briefSummary({ ...base, frequency: 'monthly' })).toContain('The next 30 days at');
    });
  });

  /** A typo in the address is the one setting whose failure is silent. */
  describe('where it goes', () => {
    it('names the address the brief is sent to', () => {
      expect(briefSummary({ ...base, email: 'ania@example.com' })).toContain(
        'emailed to ania@example.com every day',
      );
    });

    it('falls back to a placeholder while the field is empty', () => {
      expect(briefSummary({ ...base, email: '   ' })).toContain('emailed to your inbox');
    });
  });

  /** A switched-off brief sends nothing, and the line above the switch is
   *  where a reader would expect to be told. */
  describe('when the brief is off', () => {
    it('says nothing is being sent', () => {
      expect(briefSummary({ ...base, enabled: false })).toContain('Paused — nothing is being sent.');
    });

    it('stays quiet about it while the brief is on', () => {
      expect(briefSummary({ ...base, enabled: true })).not.toContain('Paused');
      expect(briefSummary(base)).not.toContain('Paused');
    });
  });
});
