import { describe, it, expect } from 'vitest';
import { newsletterSaveInput } from './newsletter-input.js';

/**
 * GOI-100's validity rules, enforced in the input schema rather than only in
 * the settings screen.
 *
 * A UI that clamps its own dropdowns is a convenience, not a guarantee: the
 * public newsletter API (GOI-87) is a second front door with no dropdowns at
 * all, and a config saved through it that the scheduler cannot act on is a
 * newsletter that silently never arrives.
 */
const base = {
  email: 'ania@example.com',
  sendCadence: 'daily' as const,
  categoryRules: [{ category: 'cinema' }],
};

function parse(over: Record<string, unknown> = {}) {
  return newsletterSaveInput.safeParse({ ...base, ...over });
}

/** The path of the first issue, for asserting the error lands on the field
 *  the settings screen will show it against. */
function firstIssuePath(result: ReturnType<typeof parse>): string {
  return result.success ? '' : result.error.issues[0]!.path.join('.');
}

describe('newsletterSaveInput', () => {
  it('accepts a plain daily newsletter with one category', () => {
    const result = parse();
    expect(result.success).toBe(true);
  });

  describe('rule 1 — a category may not appear more often than an issue is sent', () => {
    it('rejects a weekly category on a monthly newsletter', () => {
      const result = parse({
        sendCadence: 'monthly',
        sendDayOfMonth: 1,
        categoryRules: [{ category: 'cinema', cadence: 'weekly' }],
      });
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe('categoryRules.0.cadence');
    });

    // There is no separate "once a week" inside a weekly newsletter — that is
    // simply every issue, and offering both would be two names for one thing.
    it('rejects a weekly category on a weekly newsletter', () => {
      const result = parse({
        sendCadence: 'weekly',
        sendWeekday: 1,
        categoryRules: [{ category: 'cinema', cadence: 'weekly' }],
      });
      expect(result.success).toBe(false);
    });

    it('allows a monthly category on a weekly newsletter', () => {
      const result = parse({
        sendCadence: 'weekly',
        sendWeekday: 1,
        categoryRules: [{ category: 'museums', cadence: 'monthly' }],
      });
      expect(result.success).toBe(true);
    });

    it('allows every_issue everywhere', () => {
      for (const [sendCadence, extra] of [
        ['daily', {}],
        ['weekly', { sendWeekday: 3 }],
        ['monthly', { sendDayOfMonth: 5 }],
      ] as const) {
        const result = parse({
          sendCadence,
          ...extra,
          categoryRules: [{ category: 'cinema', cadence: 'every_issue' }],
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('rule 2 — fields that decide nothing are nulled, not stored', () => {
    it('drops a rule weekday outside the one combination that uses it', () => {
      const result = parse({
        sendCadence: 'weekly',
        sendWeekday: 1,
        categoryRules: [{ category: 'cinema', cadence: 'every_issue', cadenceWeekday: 4 }],
      });
      expect(result.success && result.data.categoryRules[0]!.cadenceWeekday).toBeNull();
    });

    it('keeps it for a weekly category inside a daily newsletter', () => {
      const result = parse({
        categoryRules: [{ category: 'theatre', cadence: 'weekly', cadenceWeekday: 4 }],
      });
      expect(result.success && result.data.categoryRules[0]!.cadenceWeekday).toBe(4);
    });

    it('drops the send weekday on a newsletter that is not weekly', () => {
      const result = parse({ sendCadence: 'daily', sendWeekday: 3 });
      expect(result.success && result.data.sendWeekday).toBeNull();
    });

    it('drops the send day-of-month on a newsletter that is not monthly', () => {
      const result = parse({ sendCadence: 'daily', sendDayOfMonth: 12 });
      expect(result.success && result.data.sendDayOfMonth).toBeNull();
    });
  });

  describe('rule 3 — the cadence must have the schedule field it needs', () => {
    it('rejects a weekly newsletter with no weekday', () => {
      const result = parse({ sendCadence: 'weekly', sendWeekday: null });
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe('sendWeekday');
    });

    it('rejects a monthly newsletter with no day of the month', () => {
      const result = parse({ sendCadence: 'monthly', sendDayOfMonth: null });
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe('sendDayOfMonth');
    });

    // 29th, 30th and 31st do not exist in every month, so a newsletter set to
    // one would skip February entirely.
    it('caps the day of the month at 28', () => {
      expect(parse({ sendCadence: 'monthly', sendDayOfMonth: 28 }).success).toBe(true);
      expect(parse({ sendCadence: 'monthly', sendDayOfMonth: 31 }).success).toBe(false);
    });
  });

  describe('rule 4 — a newsletter that can never have content', () => {
    it('is rejected when it has no categories and no saved events', () => {
      const result = parse({
        categoryRules: [],
        wantToGo: { enabled: false, horizonDays: 7, changesEnabled: true, urgentSend: true },
      });
      expect(result.success).toBe(false);
      expect(firstIssuePath(result)).toBe('categoryRules');
    });

    // Saved events are content. In August they are likely to be the only
    // content, which is the intended behaviour rather than a degenerate case.
    it('is accepted with no categories when saved events are on', () => {
      const result = parse({ categoryRules: [] });
      expect(result.success).toBe(true);
    });
  });

  describe('defaults', () => {
    it('gives a rule the shape the store expects without being told', () => {
      const result = parse();
      expect(result.success && result.data.categoryRules[0]).toMatchObject({
        category: 'cinema',
        cadence: 'every_issue',
        detail: 'short',
        timeFilter: 'any',
        lookaheadDays: null,
      });
    });

    it('defaults the want-to-go queue on, a week out, with changes', () => {
      const result = parse();
      expect(result.success && result.data.wantToGo).toEqual({
        enabled: true,
        horizonDays: 7,
        changesEnabled: true,
        urgentSend: true,
      });
    });

    it('numbers the rules so their order survives a round trip', () => {
      const result = parse({
        categoryRules: [{ category: 'cinema' }, { category: 'theatre' }, { category: 'music' }],
      });
      expect(result.success && result.data.categoryRules.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    });
  });

  describe('bounds', () => {
    it('keeps the lookahead to something a newsletter section can mean', () => {
      expect(parse({ categoryRules: [{ category: 'a', lookaheadDays: 1 }] }).success).toBe(true);
      expect(parse({ categoryRules: [{ category: 'a', lookaheadDays: 90 }] }).success).toBe(true);
      // Below a day it selects nothing; past a quarter it is not a section.
      expect(parse({ categoryRules: [{ category: 'a', lookaheadDays: 0 }] }).success).toBe(false);
      expect(parse({ categoryRules: [{ category: 'a', lookaheadDays: 400 }] }).success).toBe(false);
    });

    it('keeps the want-to-go horizon inside a month', () => {
      const wantToGo = { enabled: true, changesEnabled: true, urgentSend: true };
      expect(parse({ wantToGo: { ...wantToGo, horizonDays: 30 } }).success).toBe(true);
      expect(parse({ wantToGo: { ...wantToGo, horizonDays: 31 } }).success).toBe(false);
      expect(parse({ wantToGo: { ...wantToGo, horizonDays: 0 } }).success).toBe(false);
    });

    it('rejects a bad email before anything else' , () => {
      expect(parse({ email: 'not-an-address' }).success).toBe(false);
    });
  });
});
