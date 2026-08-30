import { describe, it, expect } from 'vitest';
import {
  allowedRuleCadences, deriveWindow, sendCadenceDays,
  timeFilterForHour, timeFilterHour,
  type NewsletterCategoryRule, type NewsletterSendCadence,
} from '@afisz/shared';
import { isRuleDue } from './newsletter.js';

/**
 * GOI-100: the coverage window is derived, not configured.
 *
 * This is the function the whole ticket turns on. A window the reader could
 * set is a window they could set wrong — a weekly theatre section looking one
 * day ahead reports a seventh of the week and silently loses the rest, and a
 * daily cinema section looking a week ahead repeats itself six mornings
 * running. Deriving it from the two cadences guarantees the one property that
 * matters: every event falls in exactly one issue's window per category.
 */
const ISSUE = new Date('2026-09-07T06:00:00Z'); // a Monday

function rule(over: Partial<NewsletterCategoryRule> = {}): NewsletterCategoryRule {
  return {
    category: 'cinema',
    cadence: 'every_issue',
    cadenceWeekday: null,
    detail: 'short',
    timeFilter: 'any',
    lookaheadDays: null,
    sortOrder: 0,
    ...over,
  };
}

/** The window's span in days — what every case below is really about. */
function spanDays(send: NewsletterSendCadence, r: NewsletterCategoryRule, at = ISSUE): number {
  const { from, to } = deriveWindow({ sendCadence: send }, r, at);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

describe('deriveWindow', () => {
  it('starts at the issue itself, never before it', () => {
    const { from } = deriveWindow({ sendCadence: 'daily' }, rule(), ISSUE);
    expect(from.toISOString()).toBe(ISSUE.toISOString());
  });

  describe('every issue', () => {
    it('covers 24 hours in a daily newsletter', () => {
      expect(spanDays('daily', rule({ cadence: 'every_issue' }))).toBe(1);
    });

    it('covers the week in a weekly one', () => {
      expect(spanDays('weekly', rule({ cadence: 'every_issue' }))).toBe(7);
    });

    it('covers the month in a monthly one', () => {
      expect(spanDays('monthly', rule({ cadence: 'every_issue' }))).toBe(30);
    });
  });

  describe('a category slower than the newsletter carrying it', () => {
    it('covers a week when a daily newsletter carries it weekly', () => {
      expect(spanDays('daily', rule({ cadence: 'weekly', cadenceWeekday: 1 }))).toBe(7);
    });

    it('covers a month when a daily newsletter carries it monthly', () => {
      expect(spanDays('daily', rule({ cadence: 'monthly' }))).toBe(30);
    });

    /**
     * Four issues, not a calendar month. In a weekly newsletter the next issue
     * carrying a monthly section is 28 days out; reaching 30 would print the
     * following month's first two days twice, every month.
     */
    it('covers four issues when a weekly newsletter carries it monthly', () => {
      expect(spanDays('weekly', rule({ cadence: 'monthly' }))).toBe(28);
    });
  });

  describe('the lookahead override', () => {
    it('replaces the derived span', () => {
      expect(spanDays('daily', rule({ cadence: 'every_issue', lookaheadDays: 21 }))).toBe(21);
    });

    it('moves only the far edge — the window still starts at this issue', () => {
      const { from, to } = deriveWindow(
        { sendCadence: 'weekly' },
        rule({ lookaheadDays: 30 }),
        ISSUE,
      );
      expect(from.toISOString()).toBe(ISSUE.toISOString());
      expect(to.getTime() - from.getTime()).toBe(30 * 86_400_000);
    });

    /**
     * A lookahead wider than the cadence deliberately overlaps the next
     * issue's window — that is what looking ahead *means*. The repeat is the
     * send-state dedup's problem (GOI-101), and compensating for it here by
     * moving `from` would reintroduce exactly the gap this function exists to
     * rule out: an event inside the overlap would be reported by neither
     * issue if the second one skipped past it.
     */
    it('is allowed to overlap the next issue rather than compensating', () => {
      const first = deriveWindow({ sendCadence: 'daily' }, rule({ lookaheadDays: 7 }), ISSUE);
      const next = new Date(ISSUE.getTime() + 86_400_000);
      const second = deriveWindow({ sendCadence: 'daily' }, rule({ lookaheadDays: 7 }), next);
      expect(second.from.getTime()).toBeLessThan(first.to.getTime());
    });
  });

  /** No gaps: consecutive issues' windows must meet, so nothing falls between
   *  two issues and is reported by neither. */
  it('hands off cleanly from one issue to the next', () => {
    for (const send of ['daily', 'weekly', 'monthly'] as const) {
      const first = deriveWindow({ sendCadence: send }, rule(), ISSUE);
      const nextIssue = new Date(ISSUE.getTime() + sendCadenceDays(send) * 86_400_000);
      const second = deriveWindow({ sendCadence: send }, rule(), nextIssue);
      expect(second.from.getTime()).toBe(first.to.getTime());
    }
  });
});

/**
 * Which issue carries a category. `deriveWindow` says how wide the window is;
 * this says whether there is a window at all in today's issue.
 */
describe('isRuleDue', () => {
  const monday = new Date('2026-09-07T06:00:00Z');
  const thursday = new Date('2026-09-10T06:00:00Z');
  const firstOfMonth = new Date('2026-09-01T06:00:00Z');
  const midMonth = new Date('2026-09-16T06:00:00Z');

  it('carries an every-issue rule in every issue', () => {
    for (const send of ['daily', 'weekly', 'monthly'] as const) {
      expect(isRuleDue('every_issue', send, midMonth, null)).toBe(true);
    }
  });

  it('carries a weekly rule on its own weekday in a daily newsletter', () => {
    expect(isRuleDue('weekly', 'daily', monday, 1)).toBe(true);
    expect(isRuleDue('weekly', 'daily', thursday, 1)).toBe(false);
    expect(isRuleDue('weekly', 'daily', thursday, 4)).toBe(true);
  });

  // Every issue of a weekly newsletter already is weekly. Validation stops
  // the combination being saved; a row written before that rule existed must
  // still behave sanely rather than never appearing.
  it('treats a weekly rule in a weekly newsletter as every issue', () => {
    expect(isRuleDue('weekly', 'weekly', thursday, 1)).toBe(true);
  });

  describe('a monthly rule', () => {
    it('lands on the 1st of a daily newsletter', () => {
      expect(isRuleDue('monthly', 'daily', firstOfMonth, null)).toBe(true);
      expect(isRuleDue('monthly', 'daily', midMonth, null)).toBe(false);
    });

    // A weekly newsletter has no issue on the 1st most months, so "the 1st"
    // would mean the section appeared roughly one month in seven.
    it('lands on the first issue of the month in a weekly newsletter', () => {
      expect(isRuleDue('monthly', 'weekly', monday, null)).toBe(true);   // 7 Sep
      expect(isRuleDue('monthly', 'weekly', midMonth, null)).toBe(false); // 16 Sep
    });
  });
});

/** A category cannot appear more often than an issue is sent. */
describe('allowedRuleCadences', () => {
  it('offers everything to a daily newsletter', () => {
    expect(allowedRuleCadences('daily')).toEqual(['every_issue', 'weekly', 'monthly']);
  });

  it('drops "once a week" from a weekly one, since that is every issue', () => {
    expect(allowedRuleCadences('weekly')).toEqual(['every_issue', 'monthly']);
  });

  it('leaves a monthly one with nothing to choose', () => {
    expect(allowedRuleCadences('monthly')).toEqual(['every_issue']);
  });
});

/**
 * The per-category time filter (GOI-100). It replaced a single global "only
 * events after", which silently emptied every museum section in the product:
 * exhibitions are daytime, so "after 18:00" — reasonable for cinema — meant a
 * museums block that could never match anything.
 */
describe('the time filter', () => {
  it('reads as an hour, or as no cut at all', () => {
    expect(timeFilterHour('any')).toBeNull();
    expect(timeFilterHour('after_17')).toBe(17);
    expect(timeFilterHour('after_20')).toBe(20);
  });

  it('rounds an arbitrary stored hour down to an offered option', () => {
    expect(timeFilterForHour(null)).toBe('any');
    expect(timeFilterForHour(18)).toBe('after_18');
    expect(timeFilterForHour(21)).toBe('after_20');
    // Below the earliest option there is nothing to express, and pretending
    // otherwise would narrow a section the reader never asked to narrow.
    expect(timeFilterForHour(6)).toBe('any');
  });

  it('round-trips every option it offers', () => {
    for (const f of ['after_17', 'after_18', 'after_19', 'after_20'] as const) {
      expect(timeFilterForHour(timeFilterHour(f))).toBe(f);
    }
  });
});
