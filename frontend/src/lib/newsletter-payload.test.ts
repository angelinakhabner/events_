/**
 * Every combination of newsletter settings, through the server's own schema
 * (GOI-105).
 *
 * The reported bug — "Frequency: Required", "Send weekday: Expected number,
 * received null" — was not a bad combination of settings. It was the dev
 * preview's frontend talking to the production API, which still ran the
 * schema from before GOI-100/102 split `frequency` into a send cadence and
 * per-category cadences (docs/RAILWAY.md §8). No combination of controls
 * could have avoided it, and no combination could have found it either.
 *
 * But the issue asks the right question anyway: *is* there a combination the
 * form can reach that the API rejects? Rendering the page and clicking
 * through cannot answer that — there are hundreds — so this walks the product
 * of every control against `newsletterSaveInput`, the same schema both front
 * doors validate with.
 *
 * The contract under test is one sentence: **if the form can reach it, the
 * server accepts it** — with exactly two exceptions, both of which the form
 * blocks before sending, and both of which are asserted here rather than
 * assumed.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WANT_TO_GO, allowedRuleCadences,
  type NewsletterCategoryRule, type NewsletterDelivery, type NewsletterRuleCadence,
  type NewsletterSendCadence, type NewsletterDetail, type NewsletterTimeFilter,
} from '@afisz/shared';
import { newsletterSaveInput } from '../../../backend/src/services/newsletter-input';
import { newsletterPayload, type NewsletterFormState } from './newsletter';

const SEND_CADENCES: NewsletterSendCadence[] = ['daily', 'weekly', 'monthly'];
const DELIVERIES: NewsletterDelivery[] = ['email', 'drive', 'both'];
const DETAILS: NewsletterDetail[] = ['line', 'short', 'full'];
const TIME_FILTERS: NewsletterTimeFilter[] = [
  'any', 'after_17', 'after_18', 'after_19', 'after_20',
];
/** null = "derive it", plus the ends of the range the schema accepts. */
const LOOKAHEADS: (number | null)[] = [null, 1, 30, 90];

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

function form(over: Partial<NewsletterFormState> = {}): NewsletterFormState {
  return {
    email: 'ania@example.com',
    recipientName: '',
    delivery: 'email',
    sendCadence: 'weekly',
    sendHour: 8,
    sendMinute: 0,
    sendWeekday: 1,
    sendDayOfMonth: 1,
    venueIds: [],
    rules: [rule()],
    wantToGo: DEFAULT_WANT_TO_GO,
    enabled: true,
    ...over,
  };
}

/** What the server would say to what the form would send. */
function submit(state: NewsletterFormState) {
  return newsletterSaveInput.safeParse(newsletterPayload(state));
}

/** The failing paths, as `sendWeekday` / `categoryRules.0.cadence`. */
function errorPaths(result: ReturnType<typeof submit>): string[] {
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join('.'));
}

describe('the newsletter form sends what the API accepts (GOI-105)', () => {
  /**
   * The whole schedule surface: three cadences × 24 hours × the weekday and
   * day-of-month the form would carry. The reported error named `sendWeekday`
   * on a *daily* brief, so the case that matters most is the one where the
   * form deliberately sends null.
   */
  it('accepts every send schedule the controls can produce', () => {
    const rejected: string[] = [];
    for (const sendCadence of SEND_CADENCES) {
      for (let sendHour = 0; sendHour < 24; sendHour += 1) {
        for (const sendMinute of [0, 30, 59]) {
          // Every weekday and every day of the month the form offers, so the
          // "does the irrelevant one get nulled" question is asked from a
          // non-default value too.
          for (const sendWeekday of [0, 1, 6]) {
            for (const sendDayOfMonth of [1, 15, 28]) {
              const state = form({
                sendCadence, sendHour, sendMinute, sendWeekday, sendDayOfMonth,
              });
              const result = submit(state);
              if (!result.success) {
                rejected.push(
                  `${sendCadence} ${sendHour}:${sendMinute} wd=${sendWeekday} dom=${sendDayOfMonth}` +
                  ` → ${errorPaths(result).join(', ')}`,
                );
              }
            }
          }
        }
      }
    }
    expect(rejected).toEqual([]);
  });

  /**
   * The exact shape the bug report was about. A daily brief has no weekday, so
   * the form sends null — and the schema has to be the one that accepts null,
   * not a `.default(1)` that demands a number.
   */
  it('sends null for the schedule field its cadence does not use, and is accepted', () => {
    const daily = newsletterPayload(form({ sendCadence: 'daily' }));
    expect(daily.sendWeekday).toBeNull();
    expect(daily.sendDayOfMonth).toBeNull();
    expect(newsletterSaveInput.safeParse(daily).success).toBe(true);

    const weekly = newsletterPayload(form({ sendCadence: 'weekly', sendWeekday: 4 }));
    expect(weekly.sendWeekday).toBe(4);
    expect(weekly.sendDayOfMonth).toBeNull();
    expect(newsletterSaveInput.safeParse(weekly).success).toBe(true);

    const monthly = newsletterPayload(form({ sendCadence: 'monthly', sendDayOfMonth: 12 }));
    expect(monthly.sendWeekday).toBeNull();
    expect(monthly.sendDayOfMonth).toBe(12);
    expect(newsletterSaveInput.safeParse(monthly).success).toBe(true);
  });

  /** No `frequency` field anywhere — the name the stale API asked for. */
  it('sends no field the current schema does not know', () => {
    for (const sendCadence of SEND_CADENCES) {
      const body = newsletterPayload(form({ sendCadence })) as Record<string, unknown>;
      expect(body).not.toHaveProperty('frequency');
      expect(body).not.toHaveProperty('afterHour');
      expect(Object.keys(body).sort()).toEqual([
        'categoryRules', 'delivery', 'email', 'enabled', 'folderId', 'name',
        'recipientName', 'sendCadence', 'sendDayOfMonth', 'sendHour', 'sendMinute',
        'sendWeekday', 'venueIds', 'wantToGo',
      ]);
    }
  });

  /**
   * Every category rule, under every send cadence — the full product of the
   * four controls a row carries, against the cadences the row is offered under.
   *
   * `allowedRuleCadences` is what the dropdown is built from, so this asserts
   * the dropdown and the schema agree about rule 1 ("a category cannot appear
   * more often than an issue is sent"). If they ever disagree, the form offers
   * an option that cannot be saved — which is precisely the class of bug this
   * issue is about.
   */
  it('accepts every category rule the row can be set to', () => {
    const rejected: string[] = [];
    for (const sendCadence of SEND_CADENCES) {
      for (const cadence of allowedRuleCadences(sendCadence)) {
        for (const detail of DETAILS) {
          for (const timeFilter of TIME_FILTERS) {
            for (const lookaheadDays of LOOKAHEADS) {
              // The weekday only exists for a weekly rule inside a daily
              // brief; both the value the form would carry and the null it
              // sends otherwise are exercised.
              for (const cadenceWeekday of [null, 0, 3, 6]) {
                const state = form({
                  sendCadence,
                  rules: [rule({ cadence, detail, timeFilter, lookaheadDays, cadenceWeekday })],
                });
                const result = submit(state);
                if (!result.success) {
                  rejected.push(
                    `send=${sendCadence} rule=${cadence} detail=${detail} time=${timeFilter}` +
                    ` look=${lookaheadDays} wd=${cadenceWeekday} → ${errorPaths(result).join(', ')}`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(rejected).toEqual([]);
  });

  /**
   * The other half of rule 1: a cadence the dropdown does *not* offer is
   * refused. Without this the test above would pass just as well against a
   * schema that validated nothing.
   */
  it('refuses a rule cadence more frequent than the issue that carries it', () => {
    const forbidden: [NewsletterSendCadence, NewsletterRuleCadence][] = [
      ['weekly', 'weekly'],
      ['monthly', 'weekly'],
      ['monthly', 'monthly'],
    ];
    for (const [sendCadence, cadence] of forbidden) {
      expect(allowedRuleCadences(sendCadence)).not.toContain(cadence);
      const result = submit(form({ sendCadence, rules: [rule({ cadence })] }));
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain('categoryRules.0.cadence');
    }
  });

  /** Delivery is independent of everything else, including with no drive. */
  it('accepts every delivery route under every cadence', () => {
    for (const delivery of DELIVERIES) {
      for (const sendCadence of SEND_CADENCES) {
        expect(submit(form({ delivery, sendCadence })).success).toBe(true);
      }
    }
  });

  /** Saved events in or out (GOI-103), and the newsletter switched off. */
  it('accepts the saved-events toggle and the enabled switch in both positions', () => {
    for (const wtgEnabled of [true, false]) {
      for (const enabled of [true, false]) {
        const state = form({
          wantToGo: { ...DEFAULT_WANT_TO_GO, enabled: wtgEnabled },
          enabled,
          // A rule is present, so switching saved events off is still a
          // newsletter with content — rule 4 is the next case.
          rules: [rule()],
        });
        expect(submit(state).success).toBe(true);
      }
    }
  });

  /**
   * The two configurations the server refuses. Both are reachable in the
   * *state* sense, so the form has to hold them rather than send them — and
   * it does: `emptyByConstruction` disables both buttons for the first, and
   * the email field is `required`. Asserted here so that the "everything is
   * accepted" cases above are not quietly relying on the schema being lax.
   */
  describe('what the server refuses, and the form therefore must not send', () => {
    it('a newsletter with no categories and no saved events', () => {
      const result = submit(form({
        rules: [],
        wantToGo: { ...DEFAULT_WANT_TO_GO, enabled: false },
      }));
      expect(result.success).toBe(false);
      expect(errorPaths(result)).toContain('categoryRules');
    });

    it('an empty or malformed email address', () => {
      for (const email of ['', '   ', 'not-an-address']) {
        const result = submit(form({ email }));
        expect(result.success).toBe(false);
        expect(errorPaths(result)).toContain('email');
      }
    });
  });

  /**
   * Rule 4 is about content, not about categories, so the one asymmetric case
   * is worth naming: no rules but saved events on is a perfectly good
   * newsletter, and refusing it would make "saved events only" unreachable.
   */
  it('accepts a newsletter that is nothing but saved events', () => {
    const result = submit(form({ rules: [], wantToGo: DEFAULT_WANT_TO_GO }));
    expect(result.success).toBe(true);
  });

  /**
   * Several rules at once, which is the ask GOI-103 opened with — cinema
   * daily, theatre and museums weekly, in one brief.
   */
  it('accepts a mixed-cadence brief: cinema every issue, theatre and museums weekly', () => {
    const result = submit(form({
      sendCadence: 'daily',
      rules: [
        rule({ category: 'cinema', cadence: 'every_issue', detail: 'line', sortOrder: 0 }),
        rule({ category: 'theatre', cadence: 'weekly', cadenceWeekday: 4, detail: 'full', sortOrder: 1 }),
        rule({ category: 'exhibition', cadence: 'weekly', cadenceWeekday: 1, detail: 'short', sortOrder: 2 }),
      ],
    }));
    expect(result.success).toBe(true);
    expect(result.data!.categoryRules.map((r) => r.cadence))
      .toEqual(['every_issue', 'weekly', 'weekly']);
  });
});
