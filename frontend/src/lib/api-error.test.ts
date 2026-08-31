import { describe, it, expect } from 'vitest';
import { readableApiError } from './api-error';
import { newsletterPayload } from './newsletter';
import { DEFAULT_WANT_TO_GO } from '@afisz/shared';

/** The payload the newsletter form sends today, trimmed to the shape that
 *  matters here: which field names exist, and where. */
const sent = {
  email: 'a@b.com',
  sendCadence: 'weekly',
  sendWeekday: 1,
  categoryRules: [{ category: 'cinema', cadence: 'every_issue', detail: 'short' }],
  wantToGo: { enabled: true, horizonDays: 7 },
};

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
    const out = readableApiError(message, sent);
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
    const out = readableApiError(message, sent);
    expect(out).toContain('Frequency: Required');
    expect(out).toContain('older build than this page');
  });

  it('explains an unknown procedure as the same mismatch', () => {
    const out = readableApiError('No procedure found on path "my.newsletter.sendTest"');
    expect(out).toContain('my.newsletter.sendTest');
    expect(out).toContain('older build than this page');
  });

  it('does not cry version mismatch when it has no payload to compare against', () => {
    const message = JSON.stringify([{ path: ['frequency'], message: 'Required' }]);
    expect(readableApiError(message)).toBe('Frequency: Required');
  });

  it('keeps a message that only looks like JSON', () => {
    expect(readableApiError('[not json', sent)).toBe('[not json');
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
 * The explanation was already written; it just never rendered, because it is
 * conditional on knowing what the page sent, and the page passed a ref that
 * was still null. So the case that matters is the one below: this exact
 * rejection, against the payload the form actually builds.
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

  const sent = newsletterPayload({
    email: 'ania@example.com', recipientName: '', delivery: 'email',
    sendCadence: 'daily', sendHour: 8, sendMinute: 0, sendWeekday: 1,
    sendDayOfMonth: 1, venueIds: [], rules: [], wantToGo: DEFAULT_WANT_TO_GO,
    enabled: true,
  });

  it('names the fields, then says the API is the older half', () => {
    const text = readableApiError(STALE_API, sent)!;
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
    expect(Object.keys(sent)).toContain('sendWeekday');
    expect(Object.keys(sent)).not.toContain('frequency');
    expect(readableApiError(STALE_API, sent)).toContain('older build');
  });

  /**
   * The failure mode itself: with nothing to compare against, the same
   * rejection reads as if the reader mis-set two controls they do not have.
   * The form no longer has a state in which this can happen — the payload is
   * derived from live state, never captured — and this is here to say why the
   * argument is not optional.
   */
  it('cannot explain it with no payload to compare against', () => {
    const text = readableApiError(STALE_API, null)!;
    expect(text).toContain('Frequency: Required');
    expect(text).not.toContain('older build');
  });

  /** A genuine bad value is still the reader's to fix, not a deploy. */
  it('does not blame the deployment for a field the form really does send', () => {
    const badHour = JSON.stringify([
      { code: 'too_big', path: ['sendHour'], message: 'Number must be less than or equal to 23' },
    ]);
    const text = readableApiError(badHour, sent)!;
    expect(text).toContain('Send hour: Number must be less than or equal to 23');
    expect(text).not.toContain('older build');
  });
});
