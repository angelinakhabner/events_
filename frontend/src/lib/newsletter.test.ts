import { describe, it, expect } from 'vitest';
import { briefSummary, type BriefSummaryInput, NEWSLETTER_BLURB } from './newsletter';

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
      'Najbliższe 24 godziny — Kino Muranów i Kinoteka, wysyłane na Twoją skrzynkę codziennie o 15:00.',
    );
  });

  it('names the weekday for a weekly brief', () => {
    expect(briefSummary({ ...base, frequency: 'weekly', sendWeekday: 4 })).toContain(
      'w każdy czwartek o 15:00',
    );
  });

  // Polish agrees "każdy" / "każdą" with the day: Wednesday is feminine.
  it('agrees the weekday phrase with the day', () => {
    expect(briefSummary({ ...base, frequency: 'weekly', sendWeekday: 3 })).toContain('w każdą środę');
    expect(briefSummary({ ...base, frequency: 'weekly', sendWeekday: 1 })).toContain('w każdy poniedziałek');
  });

  it('carries the minutes, zero-padded', () => {
    expect(briefSummary({ ...base, sendHour: 8, sendMinute: 5 })).toContain('o 08:05');
  });

  it('adds the after-hour cutoff only when there is one', () => {
    expect(briefSummary({ ...base, afterHour: 18 })).toContain(
      '— tylko to, co zaczyna się po 18:00.',
    );
    expect(briefSummary(base)).not.toContain('tylko to, co zaczyna się po');
  });

  // No venues ticked means the brief covers all of them — the form says so
  // under the venue list, and the summary has to agree.
  it('says "all your venues" when none are picked', () => {
    expect(briefSummary({ ...base, venueNames: [] })).toContain('— wszystkie Twoje miejsca,');
  });

  it('reads a single venue without a conjunction', () => {
    expect(briefSummary({ ...base, venueNames: ['Kinoteka'] })).toContain('— Kinoteka,');
  });

  it('lists three, then counts the rest', () => {
    expect(briefSummary({ ...base, venueNames: ['A', 'B', 'C'] })).toContain('— A, B i C,');
    expect(briefSummary({ ...base, venueNames: ['A', 'B', 'C', 'D', 'E'] })).toContain(
      '— A, B i jeszcze 3,',
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
      expect(briefSummary(base)).toContain('Najbliższe 24 godziny —');
      expect(briefSummary({ ...base, frequency: 'weekly' })).toContain('Najbliższe 7 dni —');
      expect(briefSummary({ ...base, frequency: 'monthly' })).toContain('Najbliższe 30 dni —');
    });
  });

  /** A typo in the address is the one setting whose failure is silent. */
  describe('where it goes', () => {
    it('names the address the brief is sent to', () => {
      expect(briefSummary({ ...base, email: 'ania@example.com' })).toContain(
        'wysyłane na ania@example.com codziennie',
      );
    });

    it('falls back to a placeholder while the field is empty', () => {
      expect(briefSummary({ ...base, email: '   ' })).toContain('wysyłane na Twoją skrzynkę');
    });
  });

  /** A switched-off brief sends nothing, and the line above the switch is
   *  where a reader would expect to be told. */
  describe('when the brief is off', () => {
    it('says nothing is being sent', () => {
      expect(briefSummary({ ...base, enabled: false })).toContain('Wstrzymany — nic nie jest wysyłane.');
    });

    it('stays quiet about it while the brief is on', () => {
      expect(briefSummary({ ...base, enabled: true })).not.toContain('Wstrzymany');
      expect(briefSummary(base)).not.toContain('Wstrzymany');
    });
  });
});

/**
 * The standing description of the tab (GOI-97).
 *
 * It is prose, so there is nothing to assert about how it reads — but the two
 * things the issue asked it to stop doing are testable, and they are exactly
 * the two a later edit would reintroduce without noticing.
 */
describe('NEWSLETTER_BLURB', () => {
  it('names no venue and no clock time', () => {
    expect(NEWSLETTER_BLURB).not.toMatch(/\d{1,2}:\d{2}/);
    for (const venue of ['Muranów', 'Muranow', 'Kinoteka', 'Muzeum', 'Iluzjon']) {
      expect(NEWSLETTER_BLURB).not.toContain(venue);
    }
  });

  it('describes what the feature can do — cadence, per-category rules, delivery', () => {
    expect(NEWSLETTER_BLURB).toMatch(/codziennie, raz w tygodniu albo raz w miesiącu/);
    expect(NEWSLETTER_BLURB).toMatch(/każdej kategorii/);
    expect(NEWSLETTER_BLURB).toMatch(/zasięg/);
    expect(NEWSLETTER_BLURB).toMatch(/e-mailem/);
    expect(NEWSLETTER_BLURB).toMatch(/PDF/);
  });
});
