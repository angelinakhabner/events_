import { describe, it, expect } from 'vitest';
import { newsletterApiIsStale, readableApiError } from './api-error';
import { newsletterPayload, NEWSLETTER_FIELDS } from './newsletter';
import { DEFAULT_WANT_TO_GO } from '@afisz/shared';


describe('readableApiError', () => {
  it('passes a plain message through', () => {
    expect(readableApiError('Email is not configured on this deployment'))
      .toBe('Email is not configured on this deployment');
  });

  it('returns null for no error', () => {
    expect(readableApiError(null)).toBeNull();
    expect(readableApiError('')).toBeNull();
  });

  it('turns a Zod issue dump into one line per problem', () => {
    const message = JSON.stringify([
      { path: ['sendWeekday'], message: 'A weekly newsletter needs a day of the week to go out on.' },
      { path: ['categoryRules', 1, 'cadence'], message: 'A weekly newsletter cannot carry a category once a week.' },
    ]);
    const out = readableApiError(message, NEWSLETTER_FIELDS);
    expect(out).toContain('Send weekday: A weekly newsletter needs a day of the week to go out on.');
    // One-based, so the index reads as the position a reader can count to.
    expect(out).toContain('Category rules 2 — cadence: A weekly newsletter cannot carry a category once a week.');
    expect(out).not.toContain('older build');
  });

  /** The failure this helper exists for: the API predates the form. */
  it('names a version mismatch when the API asks for fields the form has no idea about', () => {
    const message = JSON.stringify([
      { path: ['frequency'], message: 'Required' },
      { path: ['categoryRules', 1, 'frequency'], message: 'Required' },
    ]);
    const out = readableApiError(message, NEWSLETTER_FIELDS);
    expect(out).toContain('Frequency: Required');
    expect(out).toContain('older build than this page');
  });

  it('explains an unknown procedure as the same mismatch', () => {
    const out = readableApiError('No procedure found on path "my.newsletter.sendTest"');
    expect(out).toContain('my.newsletter.sendTest');
    expect(out).toContain('older build than this page');
  });

  it('does not cry version mismatch with no field set to compare against', () => {
    const message = JSON.stringify([{ path: ['frequency'], message: 'Required' }]);
    expect(readableApiError(message)).toBe('Frequency: Required');
  });

  it('keeps a message that only looks like JSON', () => {
    expect(readableApiError('[not json', NEWSLETTER_FIELDS)).toBe('[not json');
  });
});

/**
 * The regression GOI-105 was filed as.
 *
 * The dev preview's frontend talks to the production API (docs/RAILWAY.md §8),
 * which still runs the schema from before GOI-100/102 split `frequency` into a
 * send cadence. The reader pressed "Schedule newsletter" and got
 *
 *   Frequency: Required
 *   Send weekday: Expected number, received null
 *
 * and nothing else — two fields that are not on their screen, no hint that
 * this is a deployment problem rather than something they filled in wrong.
 *
 * The explanation was already written; it just never rendered. Twice, for two
 * different reasons — first because the page passed a ref that was still null,
 * and then, once that was live state, because the check read field names off
 * that live payload. An API old enough to reject this build also *served* the
 * settings the form loaded, so the form was carrying that API's own
 * `frequency` key back to it and the check agreed `frequency` was legitimate.
 * It compares against a static set now (`NEWSLETTER_FIELDS`), and the echo
 * case below is the one that would have caught it.
 */
describe('a backend older than the page (GOI-105)', () => {
  /** Verbatim from the production schema rejecting a current payload. */
  const STALE_API = JSON.stringify([
    {
      code: 'invalid_type', expected: "'daily' | 'weekly' | 'monthly'",
      received: 'undefined', path: ['frequency'], message: 'Required',
    },
    {
      code: 'invalid_type', expected: 'number', received: 'null',
      path: ['sendWeekday'], message: 'Expected number, received null',
    },
  ]);

  it('names the fields, then says the API is the older half', () => {
    const text = readableApiError(STALE_API, NEWSLETTER_FIELDS)!;
    expect(text).toContain('Frequency: Required');
    expect(text).toContain('Send weekday: Expected number, received null');
    expect(text).toContain('the API is running an older build than this page');
  });

  /**
   * `sendWeekday` *is* a field the form sends — it sends it as null. Only
   * `frequency` is unknown to this build, so one stale field among several
   * has to be enough to explain the whole rejection; requiring all of them
   * would have left this very report unexplained.
   */
  it('explains it even when only one of the named fields is unknown', () => {
    expect(NEWSLETTER_FIELDS.has('sendWeekday')).toBe(true);
    expect(NEWSLETTER_FIELDS.has('frequency')).toBe(false);
    expect(readableApiError(STALE_API, NEWSLETTER_FIELDS)).toContain('older build');
  });

  /**
   * The failure mode itself: with nothing to compare against, the same
   * rejection reads as if the reader mis-set two controls they do not have.
   * The form no longer has a state in which this can happen — the payload is
   * derived from live state, never captured — and this is here to say why the
   * argument is not optional.
   */
  it('cannot explain it with no field set to compare against', () => {
    const text = readableApiError(STALE_API, undefined)!;
    expect(text).toContain('Frequency: Required');
    expect(text).not.toContain('older build');
  });

  /**
   * The way this went on being invisible after the first fix.
   *
   * The stale API's `newsletter.get` answers with the old rule shape, the form
   * seeds its rows from it, and sends it back — so a *live* payload contains
   * `frequency`, echoed straight from the server that is about to reject it.
   * Read the known-field set off that payload and the check concludes the
   * field is one this build sends, which is exactly backwards. The static set
   * is not reachable from any server response, so it stays right.
   */
  it('is not fooled by a stale field the stale API itself sent back', () => {
    const echoed = newsletterPayload({
      email: 'ania@example.com', recipientName: '', delivery: 'email',
      sendCadence: 'weekly', sendHour: 8, sendMinute: 0, sendWeekday: 1,
      sendDayOfMonth: 1, venueIds: [],
      // What the pre-GOI-100 API returns, passed through untouched.
      rules: [{ category: 'cinema', frequency: 'daily', detail: 'short' }] as never,
      wantToGo: DEFAULT_WANT_TO_GO, enabled: true,
    });
    // The poison: the payload really does carry the field.
    expect(JSON.stringify(echoed)).toContain('frequency');
    // The static set does not, so the rejection is still read as a mismatch.
    expect(NEWSLETTER_FIELDS.has('frequency')).toBe(false);
    expect(readableApiError(STALE_API, NEWSLETTER_FIELDS)).toContain('older build');
  });

  /** A genuine bad value is still the reader's to fix, not a deploy. */
  it('does not blame the deployment for a field the form really does send', () => {
    const badHour = JSON.stringify([
      { code: 'too_big', path: ['sendHour'], message: 'Number must be less than or equal to 23' },
    ]);
    const text = readableApiError(badHour, NEWSLETTER_FIELDS)!;
    expect(text).toContain('Send hour: Number must be less than or equal to 23');
    expect(text).not.toContain('older build');
  });
});

/**
 * The same mismatch, caught before the reader presses anything.
 *
 * `readableApiError` can only speak once a request has failed, which means
 * the reader's first news of a stale deployment is a button that does not
 * work. `newsletter.get` answered long before that, and it answered in the
 * shape its own build has — so the page can say so on arrival instead.
 */
describe('newsletterApiIsStale', () => {
  /** What the pre-GOI-100 API returns: a `frequency`, and no send cadence. */
  const OLD_SETTINGS = {
    email: 'ania@example.com',
    frequency: 'weekly',
    sendHour: 8,
    sendMinute: 0,
    sendWeekday: 1,
    venueIds: [],
    categoryRules: [{ category: 'cinema', frequency: 'daily', detail: 'short' }],
    enabled: true,
  };

  const CURRENT_SETTINGS = {
    email: 'ania@example.com',
    sendCadence: 'weekly',
    sendHour: 8,
    sendMinute: 0,
    sendWeekday: 1,
    sendDayOfMonth: null,
    venueIds: [],
    categoryRules: [],
    wantToGo: DEFAULT_WANT_TO_GO,
    enabled: true,
  };

  it('spots a config served by an API that predates the cadence split', () => {
    expect(newsletterApiIsStale(OLD_SETTINGS)).toBe(true);
  });

  it('leaves a current config alone, on every cadence', () => {
    for (const sendCadence of ['daily', 'weekly', 'monthly']) {
      expect(newsletterApiIsStale({ ...CURRENT_SETTINGS, sendCadence })).toBe(false);
    }
  });

  /**
   * Nobody's first visit is a deployment problem. `newsletter.get` answers
   * null for a reader who has never saved one, from both versions of the API,
   * so null is not evidence either way — and treating it as stale would put
   * the banner in front of every new reader.
   */
  it('says nothing about a reader who has never saved a newsletter', () => {
    expect(newsletterApiIsStale(null)).toBe(false);
    expect(newsletterApiIsStale(undefined)).toBe(false);
  });
});
